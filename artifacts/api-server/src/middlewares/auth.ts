import type { NextFunction, Request, Response } from "express";
import { resolveOptionalUser } from "../lib/auth";

export type AuthContext = {
  userId: string;
  role: "member" | "reviewer" | "admin";
  isSuperAdmin?: boolean;
  permissions?: string[];
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
      res.locals.auth.isSuperAdmin = user.isSuperAdmin;
      res.locals.auth.permissions = user.permissions;
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
  if (!auth || (auth.role !== "admin" && !auth.isSuperAdmin)) {
    res.status(auth ? 403 : 401).json({
      code: auth ? "FORBIDDEN" : "UNAUTHORIZED",
      message: auth ? "Administrator role is required" : "Sign-in required",
    });
    return;
  }
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = authFor(res);
    if (!auth) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
      return;
    }
    if (!auth.isSuperAdmin && !(auth.permissions ?? []).includes(permission)) {
      res.status(403).json({ code: "FORBIDDEN", message: "Permission is required" });
      return;
    }
    next();
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = authFor(res);
  if (!auth) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    return;
  }
  if (!auth.isSuperAdmin) {
    res.status(403).json({ code: "FORBIDDEN", message: "Super Administrator access is required" });
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
