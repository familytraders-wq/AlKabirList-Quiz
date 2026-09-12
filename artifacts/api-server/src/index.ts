import { type Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Express } from "express";
import app from "./app";
import { logger } from "./lib/logger";
import {
  startAnonymousSessionCleanupWorker,
  type AnonymousSessionCleanupWorker,
} from "./lib/security";

export type ApiServerOptions = {
  app?: Express;
  port?: number;
  cleanupWorker?: AnonymousSessionCleanupWorker;
};

export type ApiServer = {
  server: Server;
  shutdown: (signal: string) => Promise<void>;
};

function configuredPort(rawPort = process.env["PORT"]): number {
  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return port;
}

export function startApiServer(options: ApiServerOptions = {}): ApiServer {
  const port = options.port ?? configuredPort();
  const cleanupWorker =
    options.cleanupWorker ?? startAnonymousSessionCleanupWorker();
  const server = (options.app ?? app).listen(port, () => {
    logger.info({ port }, "Server listening");
  });

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    void cleanupWorker.stop().finally(() => {
      process.exitCode = 1;
    });
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await cleanupWorker.stop();
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return { server, shutdown };
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(resolve(entrypoint)).href
  );
}

if (isMainModule()) {
  startApiServer();
}
