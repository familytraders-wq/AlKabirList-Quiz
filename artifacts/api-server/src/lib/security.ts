import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import {
  anonymousSessions,
  attemptAnswers,
  guestProgressLinks,
  quizAttempts,
} from "@workspace/db/schema";
import { db } from "@workspace/db";
import { logger } from "./logger";

export const ANONYMOUS_COOKIE = "__Host-alkabir_anon";
export const CSRF_COOKIE = "alkabir_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const ANONYMOUS_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ANONYMOUS_SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const ANONYMOUS_SESSION_CLEANUP_BATCH_SIZE = 100;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let lastAnonymousSessionCleanupAt = 0;
let anonymousSessionCleanupInFlight: Promise<void> | undefined;

type CookieRequest = Request & {
  cookies?: Record<string, string>;
};

function cookieSecure(): boolean {
  // The host-prefix cookie requires Secure. Development previews are HTTPS
  // through the Replit proxy, so keeping this invariant in every environment
  // also prevents a weaker local contract from reaching production.
  return true;
}

export function anonymousCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: ANONYMOUS_SESSION_MAX_AGE_MS,
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: ANONYMOUS_SESSION_MAX_AGE_MS,
  };
}

function hashSecret(): string {
  const secret = process.env.ANONYMOUS_COOKIE_HASH_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "ANONYMOUS_COOKIE_HASH_SECRET or SESSION_SECRET must be configured",
    );
  }
  return secret;
}

export function hashAnonymousToken(token: string): string {
  return createHmac("sha256", hashSecret()).update(token).digest("hex");
}

export function createAnonymousToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export async function createAnonymousSession(
  token = createAnonymousToken(),
): Promise<{ id: string; token: string; tokenHash: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ANONYMOUS_SESSION_MAX_AGE_MS);
  const tokenHash = hashAnonymousToken(token);
  const [session] = await db
    .insert(anonymousSessions)
    .values({ tokenHash, expiresAt })
    .returning({ id: anonymousSessions.id });

  if (!session) throw new Error("Anonymous session could not be created");
  return { ...session, token, tokenHash, expiresAt };
}

export type AnonymousSessionCleanupResult = {
  sessionsScanned: number;
  attemptsDeleted: number;
  sessionsDeleted: number;
};

/**
 * Remove abandoned guest attempts after their session can no longer be used.
 *
 * Completed guest attempts keep their anonymous owner so their result remains
 * recoverable. Linked sessions also remain because guestProgressLinks is the
 * audit record for the ownership transfer and intentionally restricts session
 * deletion. Only sessions with no remaining attempt or link can be removed.
 */
export async function cleanupAnonymousSessions(
  now = new Date(),
): Promise<AnonymousSessionCleanupResult> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: anonymousSessions.id })
      .from(anonymousSessions)
      .where(
        or(
          lte(anonymousSessions.expiresAt, now),
          lte(anonymousSessions.revokedAt, now),
        ),
      )
      .limit(ANONYMOUS_SESSION_CLEANUP_BATCH_SIZE);

    let attemptsDeleted = 0;
    let sessionsDeleted = 0;

    for (const candidate of candidates) {
      const abandonedAttempts = await tx
        .select({ id: quizAttempts.id })
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.anonymousSessionId, candidate.id),
            isNull(quizAttempts.userId),
            eq(quizAttempts.status, "in_progress"),
          ),
        );
      const abandonedAttemptIds = abandonedAttempts.map(({ id }) => id);

      if (abandonedAttemptIds.length > 0) {
        await tx
          .delete(attemptAnswers)
          .where(inArray(attemptAnswers.attemptId, abandonedAttemptIds));
        await tx
          .delete(quizAttempts)
          .where(inArray(quizAttempts.id, abandonedAttemptIds));
        attemptsDeleted += abandonedAttemptIds.length;
      }

      const [remainingAttempt] = await tx
        .select({ id: quizAttempts.id })
        .from(quizAttempts)
        .where(eq(quizAttempts.anonymousSessionId, candidate.id))
        .limit(1);
      const [progressLink] = await tx
        .select({ id: guestProgressLinks.id })
        .from(guestProgressLinks)
        .where(eq(guestProgressLinks.anonymousSessionId, candidate.id))
        .limit(1);

      if (!remainingAttempt && !progressLink) {
        const deleted = await tx
          .delete(anonymousSessions)
          .where(eq(anonymousSessions.id, candidate.id))
          .returning({ id: anonymousSessions.id });
        sessionsDeleted += deleted.length;
      }
    }

    return {
      sessionsScanned: candidates.length,
      attemptsDeleted,
      sessionsDeleted,
    };
  });
}

function maybeCleanupAnonymousSessions(): void {
  const now = Date.now();
  if (
    anonymousSessionCleanupInFlight ||
    now - lastAnonymousSessionCleanupAt < ANONYMOUS_SESSION_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  lastAnonymousSessionCleanupAt = now;
  anonymousSessionCleanupInFlight = cleanupAnonymousSessions()
    .then(() => undefined)
    .catch((error) => {
      logger.warn({ err: error }, "Anonymous session cleanup failed");
    })
    .finally(() => {
      anonymousSessionCleanupInFlight = undefined;
    });
}

export async function ensureSecurityCookies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    maybeCleanupAnonymousSessions();
    const cookieReq = req as CookieRequest;
    let anonymousSessionId: string | undefined;
    if (!cookieReq.cookies?.[ANONYMOUS_COOKIE]) {
      const session = await createAnonymousSession();
      anonymousSessionId = session.id;
      cookieReq.cookies = {
        ...(cookieReq.cookies ?? {}),
        [ANONYMOUS_COOKIE]: session.token,
      };
      res.cookie(
        ANONYMOUS_COOKIE,
        session.token,
        anonymousCookieOptions(),
      );
    }
    if (!anonymousSessionId && cookieReq.cookies?.[ANONYMOUS_COOKIE]) {
      const session = await db.query.anonymousSessions.findFirst({
        where: and(
          eq(anonymousSessions.tokenHash, hashAnonymousToken(cookieReq.cookies[ANONYMOUS_COOKIE])),
          isNull(anonymousSessions.revokedAt),
          gt(anonymousSessions.expiresAt, new Date()),
        ),
        columns: { id: true },
      });
      anonymousSessionId = session?.id;
    }
    res.locals.anonymousSessionId = anonymousSessionId;

    if (!cookieReq.cookies?.[CSRF_COOKIE]) {
      const csrfToken = createCsrfToken();
      cookieReq.cookies = {
        ...(cookieReq.cookies ?? {}),
        [CSRF_COOKIE]: csrfToken,
      };
      res.cookie(
        CSRF_COOKIE,
        csrfToken,
        csrfCookieOptions(),
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function rotateAnonymousCookie(res: Response): Promise<void> {
  return createAnonymousSession().then((session) => {
    res.cookie(
      ANONYMOUS_COOKIE,
      session.token,
      anonymousCookieOptions(),
    );
  });
}

export function clearAnonymousCookie(res: Response): void {
  res.clearCookie(ANONYMOUS_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
  });
}

export function getAnonymousToken(req: Request): string | null {
  return (req as CookieRequest).cookies?.[ANONYMOUS_COOKIE] ?? null;
}

export function allowedOrigins(): string[] {
  const configured = [process.env.ALLOWED_ORIGINS, process.env.WEB_ORIGIN]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const replitOrigins = [
    process.env.REPLIT_DOMAINS,
    process.env.REPLIT_DEV_DOMAIN,
  ]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((domain) => {
      const origin = /^https?:\/\//i.test(domain)
        ? domain
        : `https://${domain}`;
      return origin.replace(/\/$/, "");
    });

  return Array.from(
    new Set([
      ...configured,
      ...replitOrigins,
      "http://localhost:5173",
      "http://localhost:3000",
    ]),
  );
}

export function isExactAllowedOrigin(
  origin: string | undefined,
  origins = allowedOrigins(),
): boolean {
  if (!origin) return false;
  return origins.includes(origin.replace(/\/$/, ""));
}

export function exactOriginCors(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void): void {
  if (!origin || isExactAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }
  // Let the request reach the state-changing CSRF guard, which returns the
  // stable JSON 403 contract. CORS simply withholds response access from a
  // disallowed browser origin; it should not turn a security denial into a
  // server error.
  callback(null, false);
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!unsafeMethods.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!isExactAllowedOrigin(origin)) {
    res.status(403).json({ error: "Origin is not allowed" });
    return;
  }

  const cookieReq = req as CookieRequest;
  const csrfCookie = cookieReq.cookies?.[CSRF_COOKIE];
  const csrfHeader = req.get(CSRF_HEADER);
  if (
    !csrfCookie ||
    !csrfHeader ||
    !constantTimeEqual(csrfCookie, csrfHeader)
  ) {
    res.status(403).json({ error: "CSRF validation failed" });
    return;
  }

  next();
};
