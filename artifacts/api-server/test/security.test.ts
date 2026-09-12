import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { dirname, resolve } from "node:path";

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

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: "CSRF validation failed" });
  assert.equal(called, false);
});

test("state-changing requests reject an unexpected origin before CSRF comparison", () => {
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
      await cleanupFinished;
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

  const port = await findAvailablePort();
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

  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", childScript],
    {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/alkabir_test",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "test-only-session-secret",
        NODE_ENV: "production",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout = "";

  let stderr = "";

  const childExit = once(child, "exit");

  const waitForOutput = async (marker: string, timeoutMs = 2_000) => {
    if (stdout.includes(marker)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.stdout.off("data", onData);
        reject(new Error(`Timed out waiting for ${marker}`));
      }, timeoutMs);
      const onData = () => {
        if (!stdout.includes(marker)) return;
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      };
      child.stdout.on("data", onData);
    });
  };

async function findAvailablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0);
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Could not determine an available port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForPortClosed(port: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host: "127.0.0.1" });
        socket.once("connect", () => {
          socket.destroy();
          reject(new Error("API port is still accepting connections"));
        });
        socket.once("error", () => resolve());
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for API port ${port} to close`);
}

const apiEntryPoint = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts"),
).href;

  const childScript = `
    import { startAnonymousSessionCleanupWorker } from ${JSON.stringify(
      pathToFileURL(
        resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/security.ts"),
      ).href,
    )};
    import { startApiServer } from ${JSON.stringify(apiEntryPoint)};

    let releaseCleanup;
    const cleanupReleased = new Promise((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanupWorker = startAnonymousSessionCleanupWorker({
      intervalMs: 60_000,
      cleanup: async () => {
        process.stdout.write("cleanup-started\\n");
        await cleanupReleased;
        process.stdout.write("cleanup-finished\\n");
        return { sessionsScanned: 0, attemptsDeleted: 0, sessionsDeleted: 0 };
      },
    });
    process.stdin.on("data", (chunk) => {
      if (chunk.toString().trim() === "release") releaseCleanup();
    });
    startApiServer({ port: ${port}, cleanupWorker });
  `;

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host: "127.0.0.1" });
        socket.once("connect", () => socket.end(() => resolve()));
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for API port ${port}`);
}

    const [exitCode, signal] = await childExit;
