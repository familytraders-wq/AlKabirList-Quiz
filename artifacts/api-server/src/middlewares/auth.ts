import type { NextFunction, Request, Response } from "express";

export type AuthContext = {
  userId: string;
  role: "member" | "reviewer" | "admin";
};

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
