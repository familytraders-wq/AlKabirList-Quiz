import type { NextFunction, Request, Response } from "express";
import { resolveOptionalUser } from "../lib/auth";

export type AuthContext = {
  userId: string;
  role: "member" | "reviewer" | "admin";
};

export async function resolveAuthContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await resolveOptionalUser(req);
    if (user) {
      res.locals.auth = {
        userId: user.id,
        role: user.roles.includes("admin")
          ? "admin"
          : user.roles.includes("reviewer")
            ? "reviewer"
            : "member",
      } satisfies AuthContext;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function authFor(res: Response): AuthContext | undefined {
  return res.locals.auth as AuthContext | undefined;
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!authFor(res)) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    return;
  }
  next();
}

export function requireReviewer(req: Request, res: Response, next: NextFunction) {
  const auth = authFor(res);
  if (!auth || !["reviewer", "admin"].includes(auth.role)) {
    res.status(auth ? 403 : 401).json({
      code: auth ? "FORBIDDEN" : "UNAUTHORIZED",
      message: auth ? "A trusted reviewer role is required" : "Sign-in required",
    });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = authFor(res);
  if (!auth || auth.role !== "admin") {
    res.status(auth ? 403 : 401).json({
      code: auth ? "FORBIDDEN" : "UNAUTHORIZED",
      message: auth ? "Administrator role is required" : "Sign-in required",
    });
    return;
  }
  next();
}

export function getOwner(res: Response) {
  const auth = authFor(res);
  const anonymousSessionId = res.locals.anonymousSessionId as string | undefined;
  return auth
    ? { userId: auth.userId, anonymousSessionId: undefined }
    : { userId: undefined, anonymousSessionId };
}
