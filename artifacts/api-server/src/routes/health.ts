import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { ReadyHealthResponse, LiveHealthResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();
/** Readiness must never hold a load-balancer probe open indefinitely. */
export const READINESS_TIMEOUT_MS = 2_000;

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
router.get("/livez", (_req, res) => res.json(LiveHealthResponse.parse({ status: "ok" })));
router.get("/readyz", async (_req, res) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("readiness check timed out")), READINESS_TIMEOUT_MS);
      }),
    ]);
    res.json(ReadyHealthResponse.parse({ status: "ok" }));
  } catch {
    res.status(503).json(ReadyHealthResponse.parse({ status: "unavailable" }));
  } finally {
    if (timer) clearTimeout(timer);
  }
});

export default router;
