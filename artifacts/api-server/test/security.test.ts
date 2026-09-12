import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/alkabir_test";
process.env.SESSION_SECRET ??= "test-only-session-secret";

const {
  ANONYMOUS_SESSION_MAX_AGE_MS,
  anonymousCookieOptions,
  constantTimeEqual,
  csrfCookieOptions,
  csrfProtection,
  createAnonymousToken,
  exactOriginCors,
  getAnonymousSessionCleanupHealth,
  hashAnonymousToken,
  isExactAllowedOrigin,
  startAnonymousSessionCleanupWorker,
} = await import("../src/lib/security.ts");

test("anonymous owner values are opaque and stored as keyed hashes", () => {
  const token = createAnonymousToken();
  const hash = hashAnonymousToken(token);

  assert.notEqual(token, hash);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashAnonymousToken(token), hash);
  assert.notEqual(hashAnonymousToken(`${token}-different`), hash);
});

test("anonymous and CSRF cookies enforce the browser security contract", () => {
  const anonymousOptions = anonymousCookieOptions();
  const csrfOptions = csrfCookieOptions();

  assert.equal(anonymousOptions.httpOnly, true);
  assert.equal(anonymousOptions.secure, true);
  assert.equal(anonymousOptions.sameSite, "lax");
  assert.equal(anonymousOptions.path, "/");
  assert.equal(anonymousOptions.maxAge, ANONYMOUS_SESSION_MAX_AGE_MS);
  assert.equal(csrfOptions.httpOnly, false);
  assert.equal(csrfOptions.secure, true);
  assert.equal(csrfOptions.sameSite, "lax");
  assert.equal(csrfOptions.path, "/");
});

test("guest cleanup health starts with aggregate-only telemetry", () => {
  const health = getAnonymousSessionCleanupHealth();

  assert.equal(health.status, "unknown");
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastAttemptAt, null);
  assert.equal(health.lastSuccessAt, null);
  assert.equal(health.lastFailureAt, null);
  assert.equal(health.sessionsScanned, 0);
  assert.equal(health.attemptsDeleted, 0);
  assert.equal(health.sessionsDeleted, 0);
  assert.equal(health.expiredSessionsRemaining, 0);
  assert.equal(health.abandonedAttemptsRemaining, 0);
  assert.deepEqual(
    Object.keys(health).sort(),
    [
      "abandonedAttemptsRemaining",
      "attemptsDeleted",
      "consecutiveFailures",
      "expiredSessionsRemaining",
      "lastAttemptAt",
      "lastFailureAt",
      "lastSuccessAt",
      "sessionsDeleted",
      "sessionsScanned",
      "status",
    ],
  );
});

test("origin validation is exact and never treats a lookalike as same-origin", () => {
  const allowed = ["https://challenge.example", "http://localhost:5173"];

  assert.equal(isExactAllowedOrigin("https://challenge.example", allowed), true);
  assert.equal(isExactAllowedOrigin("https://challenge.example.evil", allowed), false);
  assert.equal(isExactAllowedOrigin("https://challenge.example/path", allowed), false);
  assert.equal(isExactAllowedOrigin(undefined, allowed), false);
});

test("CORS withholds access for an unexpected origin without creating a server error", () => {
  let callbackArgs: [Error | null, boolean | undefined] | undefined;
  exactOriginCors("https://challenge.example.evil", (error, allowed) => {
    callbackArgs = [error, allowed];
  });
  assert.deepEqual(callbackArgs, [null, false]);
});

test("state-changing requests reject missing origin and CSRF", () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const request = {
    method: "POST",
    get(name: string) {
      if (name.toLowerCase() === "origin") return "http://localhost:5173";
      return undefined;
    },
    cookies: { alkabir_csrf: "cookie-token" },
  };
  let called = false;

  csrfProtection(
    request as never,
    response as never,
    () => {
      called = true;
    },
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "CSRF validation failed" });
  assert.equal(called, false);
});

test("state-changing requests reject an unexpected origin before CSRF comparison", () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const request = {
    method: "POST",
    get(name: string) {
      if (name.toLowerCase() === "origin") return "https://challenge.example.evil";
      if (name.toLowerCase() === "x-csrf-token") return "cookie-token";
      return undefined;
    },
    cookies: { alkabir_csrf: "cookie-token" },
  };

  csrfProtection(request as never, response as never, () => undefined);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "Origin is not allowed" });
});

test("anonymous session cleanup worker retries after a failed run", async () => {
  let runs = 0;
  const worker = startAnonymousSessionCleanupWorker({
    intervalMs: 10,
    cleanup: async () => {
      runs += 1;
      if (runs === 1) {
        throw new Error("temporary cleanup failure");
      }
      return { sessionsScanned: 0, attemptsDeleted: 0, sessionsDeleted: 0 };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 35));
  await worker.stop();

  assert.ok(runs >= 2);
});

test("stopping the cleanup worker waits for active cleanup and prevents future runs", async () => {
  let resolveCleanup!: () => void;
  let runs = 0;
  const cleanupFinished = new Promise<void>((resolve) => {
    resolveCleanup = resolve;
  });
  const worker = startAnonymousSessionCleanupWorker({
    intervalMs: 10,
    cleanup: async () => {
      runs += 1;
      await cleanupFinished;
      return { sessionsScanned: 0, attemptsDeleted: 0, sessionsDeleted: 0 };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const stopPromise = worker.stop();
  let stopped = false;
  void stopPromise.then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(stopped, false);

  resolveCleanup();
  await stopPromise;
  const runsAtStop = runs;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(runs, runsAtStop);
});

test("matching origin and double-submit CSRF token are accepted", () => {
  const response = {
    statusCode: 200,
    json() {
      return this;
    },
  };
  const request = {
    method: "POST",
    get(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "origin") return "http://localhost:5173";
      if (normalized === "x-csrf-token") return "cookie-token";
      return undefined;
    },
    cookies: { alkabir_csrf: "cookie-token" },
  };
  let called = false;

  csrfProtection(
    request as never,
    response as never,
    () => {
      called = true;
    },
  );

  assert.equal(called, true);
  assert.equal(constantTimeEqual("cookie-token", "cookie-token"), true);
});