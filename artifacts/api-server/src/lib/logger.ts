import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const OPERATOR_ALERT_WEBHOOK_TIMEOUT_MS = 5_000;

export type OperatorAlertPayload = Readonly<{
  alert:
    | "anonymous_session_cleanup_failed"
    | "anonymous_session_cleanup_backlog";
  cleanup: "anonymous_sessions";
  cleanupStatus: "failed" | "backlog";
  consecutiveFailures: number;
  consecutiveBacklogRuns: number;
  sessionsScanned: number;
  attemptsDeleted: number;
  sessionsDeleted: number;
  expiredSessionsRemaining: number;
  abandonedAttemptsRemaining: number;
  action: string;
}>;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Send an aggregate-only operator alert to the configured webhook. Delivery
 * is intentionally best effort: an unavailable notification destination must
 * not block guest-session cleanup or make an incident worse.
 */
export async function notifyOperatorAlert(
  payload: OperatorAlertPayload,
): Promise<void> {
  const configuredDestination = process.env.OPERATOR_ALERT_WEBHOOK_URL?.trim();
  if (!configuredDestination) return;

  let destination: URL;
  try {
    destination = new URL(configuredDestination);
    if (destination.protocol !== "http:" && destination.protocol !== "https:") {
      throw new Error("Operator alert destination must use HTTP(S)");
    }
  } catch {
    logger.warn(
      { alert: payload.alert },
      "Operator alert destination is invalid",
    );
    return;
  }

  const routedPayload = {
    source: "alkabir-api",
    severity: "critical",
    occurredAt: new Date().toISOString(),
    ...payload,
  };

  try {
    const response = await fetch(destination, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routedPayload),
      signal: AbortSignal.timeout(OPERATOR_ALERT_WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Operator alert destination returned ${response.status}`);
    }
  } catch (error) {
    logger.warn(
      {
        alert: payload.alert,
        deliveryError:
          error instanceof Error ? error.message.split(" ")[0] : "unknown",
      },
      "Operator alert delivery failed",
    );
  }
}
