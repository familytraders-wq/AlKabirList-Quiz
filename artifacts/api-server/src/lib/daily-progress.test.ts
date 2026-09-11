import assert from "node:assert/strict";
import test from "node:test";
import { DailyProgressLedger } from "./daily-progress.ts";
import { canonicalDateAt } from "./daily-policy.ts";

test("uses the UTC date immediately before and after midnight", () => {
  assert.equal(
    canonicalDateAt("2026-09-10T23:59:59.999Z"),
    "2026-09-10",
  );
  assert.equal(canonicalDateAt("2026-09-11T00:00:00.000Z"), "2026-09-11");

  const ledger = new DailyProgressLedger();
  const beforeMidnight = ledger.issueAttempt({
    id: "attempt-before-midnight",
    challengeId: "challenge-2026-09-10",
    issuedAt: "2026-09-10T23:59:59.999Z",
    owner: { kind: "member", memberId: "member-1" },
  });
  const atMidnight = ledger.issueAttempt({
    id: "attempt-at-midnight",
    challengeId: "challenge-2026-09-11",
    issuedAt: "2026-09-11T00:00:00.000Z",
    owner: { kind: "member", memberId: "member-1" },
  });

  assert.equal(beforeMidnight.challengeDate, "2026-09-10");
  assert.equal(atMidnight.challengeDate, "2026-09-11");
});

test("an attempt crossing midnight remains tied to its issued challenge date", () => {
  const ledger = new DailyProgressLedger();
  ledger.issueAttempt({
    id: "crossing-attempt",
    challengeId: "challenge-2026-09-10",
    issuedAt: "2026-09-10T23:59:59.999Z",
    owner: { kind: "member", memberId: "member-1" },
  });

  const result = ledger.completeAttempt({
    attemptId: "crossing-attempt",
    completedAt: "2026-09-11T00:00:00.001Z",
  });

  assert.equal(result.attempt.challengeId, "challenge-2026-09-10");
  assert.equal(result.attempt.challengeDate, "2026-09-10");
  assert.equal(result.completion?.challengeDate, "2026-09-10");
  assert.equal(result.completion?.streak, 1);
});

test("duplicate completion and reward requests are idempotent per member and UTC date", () => {
  const ledger = new DailyProgressLedger();
  ledger.issueAttempt({
    id: "first-attempt",
    challengeId: "challenge-2026-09-11",
    issuedAt: "2026-09-11T00:00:00.000Z",
    owner: { kind: "member", memberId: "member-1" },
  });

  const first = ledger.completeAttempt({
    attemptId: "first-attempt",
    completedAt: "2026-09-11T12:00:00.000Z",
  });
  const retry = ledger.completeAttempt({
    attemptId: "first-attempt",
    completedAt: "2026-09-11T23:59:59.999Z",
  });
  const firstReward = ledger.claimReward({
    memberId: "member-1",
    challengeDate: "2026-09-11",
  });
  const rewardRetry = ledger.claimReward({
    memberId: "member-1",
    challengeDate: "2026-09-11",
  });

  assert.deepEqual(retry, first);
  assert.deepEqual(rewardRetry, firstReward);

  ledger.issueAttempt({
    id: "second-attempt-same-day",
    challengeId: "challenge-2026-09-11",
    issuedAt: "2026-09-11T18:00:00.000Z",
    owner: { kind: "member", memberId: "member-1" },
  });
  const secondAttemptResult = ledger.completeAttempt({
    attemptId: "second-attempt-same-day",
    completedAt: "2026-09-11T18:01:00.000Z",
  });

  assert.equal(secondAttemptResult.completion?.id, first.completion?.id);
  assert.equal(secondAttemptResult.completion?.reward.id, firstReward.id);
  assert.equal(ledger.getMemberProgress("member-1").currentStreak, 1);
});

test("linking guest progress keeps its canonical date and credits the linked member once", () => {
  const ledger = new DailyProgressLedger();
  ledger.issueAttempt({
    id: "guest-crossing-attempt",
    challengeId: "challenge-2026-09-10",
    issuedAt: "2026-09-10T23:59:59.999Z",
    owner: { kind: "guest", guestId: "guest-cookie-hash" },
  });

  const linked = ledger.linkGuestAttempt({
    attemptId: "guest-crossing-attempt",
    guestId: "guest-cookie-hash",
    memberId: "member-1",
  });
  assert.equal(linked.challengeDate, "2026-09-10");

  const completed = ledger.completeAttempt({
    attemptId: "guest-crossing-attempt",
    completedAt: "2026-09-11T00:00:00.001Z",
  });
  assert.equal(completed.completion?.memberId, "member-1");
  assert.equal(completed.completion?.challengeDate, "2026-09-10");
  assert.equal(
    ledger.getMemberProgress("member-1").lastQualifyingDate,
    "2026-09-10",
  );

  const linkedAgain = ledger.getAttempt("guest-crossing-attempt");
  assert.equal(linkedAgain?.challengeDate, "2026-09-10");
  assert.equal(linkedAgain?.owner.kind, "member");
});