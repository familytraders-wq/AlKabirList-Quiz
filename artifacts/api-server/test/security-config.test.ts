import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/alkabir_test";
process.env.SESSION_SECRET ??= "test-only-session-secret";

const {
  ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS,
  ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS_ENV,
  DEFAULT_ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS,
  parseAnonymousSessionCleanupAlertAfterRuns,
} = await import("../src/lib/security.ts");

test("cleanup alert configuration has one shared positive-integer contract", () => {
  assert.equal(
    ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS_ENV,
    "ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS",
  );
  assert.equal(
    DEFAULT_ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS,
    3,
  );
  assert.equal(
    ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS,
    parseAnonymousSessionCleanupAlertAfterRuns(
      process.env[ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS_ENV],
    ),
  );
  assert.equal(parseAnonymousSessionCleanupAlertAfterRuns("7"), 7);
});

test("invalid cleanup alert configuration falls back to the safe default", () => {
  for (const rawValue of ["", "0", "-1", "1.5", "1e2", " 4 "]) {
    assert.equal(
      parseAnonymousSessionCleanupAlertAfterRuns(rawValue),
      DEFAULT_ANONYMOUS_SESSION_CLEANUP_ALERT_AFTER_RUNS,
      `expected ${JSON.stringify(rawValue)} to use the safe default`,
    );
  }
});