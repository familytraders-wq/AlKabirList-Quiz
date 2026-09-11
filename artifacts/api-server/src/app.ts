import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { authErrorHandler } from "./lib/auth";
import type { AuthContext } from "./middlewares/auth";
import { resolveAuthContext } from "./middlewares/auth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { ensureSecurityCookies, exactOriginCors } from "./lib/security";

type AppOptions = {
  resolveAuth?: (req: express.Request) => AuthContext | undefined;
};

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(
    cors({
      credentials: true,
      origin: (origin, callback) => exactOriginCors(origin, callback),
      methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );

  const resolveRequestAuth = options.resolveAuth
    ? (req: express.Request, res: express.Response, next: express.NextFunction) => {
        res.locals.auth = options.resolveAuth?.(req);
        next();
      }
    : resolveAuthContext;

  app.use("/api", ensureSecurityCookies, resolveRequestAuth, router);
  app.use(authErrorHandler);
  return app;
}

export default createApp();