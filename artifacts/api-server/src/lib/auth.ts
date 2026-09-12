import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { userRoles, users } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export type ApplicationRole = "reviewer" | "admin";

export type AuthenticatedUser = {
  id: string;
  clerkUserId: string;
  roles: ApplicationRole[];
};

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
};

function getClerkSubject(req: Request): string | null {
  const auth = getAuth(req);
  return auth.userId ?? null;
}

export async function resolveUser(clerkUserId: string): Promise<AuthenticatedUser> {
  const user = await db.transaction(async (tx) => {
    const mapped = await tx.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
    });
    if (mapped) return mapped;

    // Legacy installations used the Clerk subject directly as users.id. Claim
    // only an unmistakable exact match, and only while it is unmapped.
    const [claimed] = await tx
      .update(users)
      .set({ clerkUserId, updatedAt: new Date() })
      .where(and(eq(users.id, clerkUserId), isNull(users.clerkUserId)))
      .returning();
    if (claimed) return claimed;

    await tx.insert(users).values({ clerkUserId }).onConflictDoNothing({
      target: users.clerkUserId,
    });
    return tx.query.users.findFirst({ where: eq(users.clerkUserId, clerkUserId) });
  });
  if (!user) throw new Error("Authenticated user could not be provisioned");

  const roleRows = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, user.id),
  });

  return {
    id: user.id,
    clerkUserId: user.clerkUserId ?? clerkUserId,
    roles: roleRows.map((row) => row.role),
  };
}

/**
 * Resolve the verified Clerk subject to the internal user. This is deliberately
 * separate from guest ownership: an absent session is anonymous, but an
 * authenticated subject that cannot be provisioned is an authorization error.
 */
export async function resolveOptionalUser(
  req: Request,
): Promise<AuthenticatedUser | null> {
  const clerkUserId = getClerkSubject(req);
  if (!clerkUserId) return null;

  const user = await resolveUser(clerkUserId);
  (req as AuthenticatedRequest).authUser = user;
  return user;
}

export const optionalUser: RequestHandler = async (req, res, next) => {
  try {
    const testAuth = res.locals.auth as
      | { userId: string; role: "member" | "reviewer" | "admin" }
      | undefined;
    if (res.locals.authOverride === true) {
      if (testAuth) {
        (req as AuthenticatedRequest).authUser = {
          id: testAuth.userId,
          clerkUserId: testAuth.userId,
          roles: testAuth.role === "member" ? [] : [testAuth.role],
        };
      }
      next();
      return;
    }
    await resolveOptionalUser(req);
    next();
  } catch (error) {
    next(error);
  }
};

export const requiredUser: RequestHandler = async (req, res, next) => {
  try {
    const testAuth = res.locals.auth as
      | { userId: string; role: "member" | "reviewer" | "admin" }
      | undefined;
    if (res.locals.authOverride === true) {
      if (!testAuth) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      (req as AuthenticatedRequest).authUser = {
        id: testAuth.userId,
        clerkUserId: testAuth.userId,
        roles: testAuth.role === "member" ? [] : [testAuth.role],
      };
      next();
      return;
    }
    const user = await resolveOptionalUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function getRequestUser(req: Request): AuthenticatedUser | null {
  return (req as AuthenticatedRequest).authUser ?? null;
}

export function requireRole(
  minimumRole: ApplicationRole,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const user = getRequestUser(req) ?? (await resolveOptionalUser(req));
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const allowed =
        minimumRole === "reviewer"
          ? user.roles.includes("reviewer") || user.roles.includes("admin")
          : user.roles.includes("admin");

      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export const reviewerOrAdmin = requireRole("reviewer");
export const adminOnly = requireRole("admin");

export function authErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const detail = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: typeof error, message: String(error), stack: undefined };
  (req as Request & { log?: { error: (object: unknown, message: string) => void } }).log?.error(
    { error: detail },
    "Unhandled request error",
  );
  res.status(500).json({ error: "Internal server error" });
}