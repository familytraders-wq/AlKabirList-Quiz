import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import type { AuthContext } from "./middlewares/auth";

type AppOptions = {
  resolveAuth?: (req: express.Request) => AuthContext | undefined;
};

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();
  const sessionSecret =
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === "production"
      ? (() => {
          throw new Error("SESSION_SECRET is required in production");
        })()
      : "local-development-session-secret");

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
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser(sessionSecret));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const existing = req.signedCookies?.["alkabir_guest_session"];
    const sessionId = existing || randomUUID();
    res.locals.anonymousSessionId = sessionId;
    if (!existing) {
      res.cookie("alkabir_guest_session", sessionId, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 180,
      });
    }
    if (options.resolveAuth) {
      res.locals.auth = options.resolveAuth(req);
    }
    next();
  });

  app.use("/api", router);

  return app;
}

export default createApp();
