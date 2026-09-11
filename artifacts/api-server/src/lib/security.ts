import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { anonymousSessions } from "@workspace/db/schema";
import { db } from "@workspace/db";

export const ANONYMOUS_COOKIE = "__Host-alkabir_anon";
export const CSRF_COOKIE = "alkabir_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const ANONYMOUS_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

export async function ensureSecurityCookies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
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
  const configured = [
    process.env.ALLOWED_ORIGINS,
    process.env.WEB_ORIGIN,
    process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : undefined,
  ]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return Array.from(
    new Set([
      ...configured,
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
