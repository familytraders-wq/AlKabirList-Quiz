import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { notifyOperatorAlert, type OperatorAlertPayload } from "../src/lib/logger.ts";

const alertPayload: OperatorAlertPayload = {
  alert: "anonymous_session_cleanup_failed",
  cleanup: "anonymous_sessions",
  cleanupStatus: "failed",
  consecutiveFailures: 3,
  consecutiveBacklogRuns: 0,
  sessionsScanned: 0,
  attemptsDeleted: 0,
  sessionsDeleted: 0,
  expiredSessionsRemaining: 0,
  abandonedAttemptsRemaining: 0,
  action: "Investigate the cleanup worker and database errors.",
};

async function listenForAlert(): Promise<{
  url: string;
  request: Promise<{ body: string; headers: Record<string, string | string[] | undefined> }>;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.resolve({ body, headers: request.headers });
      response.writeHead(204).end();
    });
  });
  let receivedResolve!: (
    value: {
      body: string;
      headers: Record<string, string | string[] | undefined>;
    },
  ) => void;
  const received = {
    promise: new Promise<{
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }>((resolve) => {
      receivedResolve = resolve;
    }),
    resolve: (value: {
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }) => receivedResolve(value),
  };
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    url: `http://127.0.0.1:${address.port}/alerts`,
    request: received.promise,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("routes distinct aggregate-only cleanup alerts to the configured destination", async () => {
  const [failureDestination, backlogDestination] = await Promise.all([
    listenForAlert(),
    listenForAlert(),
  ]);
  const previousDestination = process.env.OPERATOR_ALERT_WEBHOOK_URL;
  process.env.OPERATOR_ALERT_WEBHOOK_URL = failureDestination.url;

  try {
    await notifyOperatorAlert(alertPayload);
    const request = await failureDestination.request;
    const body = JSON.parse(request.body) as Record<string, unknown>;

    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(body.alert, "anonymous_session_cleanup_failed");
    assert.equal(body.cleanupStatus, "failed");
    assert.equal(body.consecutiveFailures, 3);
    assert.equal(body.sessionsScanned, 0);
    assert.equal("token" in body, false);
    assert.equal("cookie" in body, false);
    assert.equal("sessionId" in body, false);
    assert.deepEqual(Object.keys(body).sort(), [
      "abandonedAttemptsRemaining",
      "action",
      "alert",
      "attemptsDeleted",
      "cleanup",
      "cleanupStatus",
      "consecutiveBacklogRuns",
      "consecutiveFailures",
      "expiredSessionsRemaining",
      "occurredAt",
      "sessionsDeleted",
      "sessionsScanned",
      "severity",
      "source",
    ]);

    process.env.OPERATOR_ALERT_WEBHOOK_URL = backlogDestination.url;
    await notifyOperatorAlert({
      ...alertPayload,
      alert: "anonymous_session_cleanup_backlog",
      cleanupStatus: "backlog",
      consecutiveFailures: 0,
      consecutiveBacklogRuns: 3,
      action:
        "Investigate cleanup throughput and remove the remaining guest-session backlog.",
    });
    const backlogRequest = await backlogDestination.request;
    const backlogBody = JSON.parse(backlogRequest.body) as Record<
      string,
      unknown
    >;
    assert.equal(backlogBody.alert, "anonymous_session_cleanup_backlog");
    assert.equal(backlogBody.cleanupStatus, "backlog");
    assert.equal(backlogBody.consecutiveBacklogRuns, 3);
  } finally {
    if (previousDestination === undefined) {
      delete process.env.OPERATOR_ALERT_WEBHOOK_URL;
    } else {
      process.env.OPERATOR_ALERT_WEBHOOK_URL = previousDestination;
    }
    await Promise.all([
      failureDestination.close(),
      backlogDestination.close(),
    ]);
  }
});


test("does not attempt delivery when no operator destination is configured", async () => {
  const previousDestination = process.env.OPERATOR_ALERT_WEBHOOK_URL;
  delete process.env.OPERATOR_ALERT_WEBHOOK_URL;

  try {
    await notifyOperatorAlert(alertPayload);
  } finally {
    if (previousDestination === undefined) {
      delete process.env.OPERATOR_ALERT_WEBHOOK_URL;
    } else {
      process.env.OPERATOR_ALERT_WEBHOOK_URL = previousDestination;
    }
  }
});