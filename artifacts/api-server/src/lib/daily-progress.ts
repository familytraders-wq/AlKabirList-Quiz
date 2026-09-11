import { randomUUID } from "node:crypto";
import {
  addUtcDays,
  assertCanonicalDate,
  canonicalDateAt,
  canonicalDateFrom,
  type CanonicalDate,
  isNextUtcDay,
} from "./daily-policy.ts";

export type DailyOwner =
  | { kind: "member"; memberId: string }
  | { kind: "guest"; guestId: string };

export interface DailyAttempt {
  id: string;
  challengeId: string;
  challengeDate: CanonicalDate;
  issuedAt: Date;
  owner: DailyOwner;
  completedAt?: Date;
}

export interface DailyReward {
  id: string;
  memberId: string;
  challengeDate: CanonicalDate;
  points: number;
}

export interface DailyCompletion {
  id: string;
  attemptId: string;
  memberId: string;
  challengeDate: CanonicalDate;
  completedAt: Date;
  streak: number;
  reward: DailyReward;
}

export interface DailyCompletionResult {
  attempt: DailyAttempt;
  completion?: DailyCompletion;
}

export interface MemberDailyProgress {
  memberId: string;
  currentStreak: number;
  lastQualifyingDate?: CanonicalDate;
  completedDates: CanonicalDate[];
}

/**
 * A small policy-oriented ledger used by the API layer and its boundary
 * tests. Production persistence can implement the same operations with the
 * database uniqueness constraints in schema/index.ts.
 */
export class DailyProgressLedger {
  private readonly attempts = new Map<string, DailyAttempt>();
  private readonly completionsByMemberDate = new Map<string, DailyCompletion>();
  private readonly rewardsByMemberDate = new Map<string, DailyReward>();

  issueAttempt(input: {
    id?: string;
    challengeId: string;
    issuedAt: Date | string | number;
    owner: DailyOwner;
  }): DailyAttempt {
    const issuedAt = toDate(input.issuedAt);
    const attempt: DailyAttempt = {
      id: input.id ?? randomUUID(),
      challengeId: input.challengeId,
      challengeDate: canonicalDateAt(issuedAt),
      issuedAt,
      owner: cloneOwner(input.owner),
    };

    if (this.attempts.has(attempt.id)) {
      throw new Error(`Attempt "${attempt.id}" already exists.`);
    }

    this.attempts.set(attempt.id, attempt);
    return cloneAttempt(attempt);
  }

  getAttempt(attemptId: string): DailyAttempt | undefined {
    const attempt = this.attempts.get(attemptId);
    return attempt ? cloneAttempt(attempt) : undefined;
  }

  /**
   * Explicit linking changes ownership only. It never derives a new date
   * from the link time or from the member's local timezone.
   */
  linkGuestAttempt(input: {
    attemptId: string;
    guestId: string;
    memberId: string;
  }): DailyAttempt {
    const attempt = this.requireAttempt(input.attemptId);

    if (attempt.owner.kind !== "guest" || attempt.owner.guestId !== input.guestId) {
      throw new Error("The guest does not own this attempt.");
    }

    attempt.owner = { kind: "member", memberId: input.memberId };

    if (attempt.completedAt) {
      this.ensureMemberCompletion(attempt);
    }

    return cloneAttempt(attempt);
  }

  /**
   * Completing after midnight still uses attempt.challengeDate. The
   * completion and reward maps make retries, concurrent requests, and a
   * second attempt on the same member/date return the original ledger entry.
   */
  completeAttempt(input: {
    attemptId: string;
    completedAt: Date | string | number;
  }): DailyCompletionResult {
    const attempt = this.requireAttempt(input.attemptId);
    const completedAt = toDate(input.completedAt);
    attempt.completedAt ??= completedAt;

    const completion =
      attempt.owner.kind === "member"
        ? this.ensureMemberCompletion(attempt)
        : undefined;

    return {
      attempt: cloneAttempt(attempt),
      completion: completion ? cloneCompletion(completion) : undefined,
    };
  }

  /**
   * Reward reads/writes are idempotent by the same UTC member/date key used
   * for completion. A reward cannot be claimed for an uncompleted date.
   */
  claimReward(input: {
    memberId: string;
    challengeDate: string;
  }): DailyReward {
    const challengeDate = canonicalDateFrom(input.challengeDate);
    const key = memberDateKey(input.memberId, challengeDate);
    const completion = this.completionsByMemberDate.get(key);

    if (!completion) {
      throw new Error("A daily completion is required before claiming a reward.");
    }

    const reward = this.rewardsByMemberDate.get(key) ?? completion.reward;
    this.rewardsByMemberDate.set(key, reward);
    return cloneReward(reward);
  }

  getMemberProgress(memberId: string): MemberDailyProgress {
    const dates = [...this.completionsByMemberDate.values()]
      .filter((completion) => completion.memberId === memberId)
      .map((completion) => completion.challengeDate)
      .sort();

    const uniqueDates = [...new Set(dates)];
    const lastQualifyingDate = uniqueDates.at(-1);
    let currentStreak = 0;

    if (lastQualifyingDate) {
      currentStreak = 1;
      let date = lastQualifyingDate;

      while (uniqueDates.includes(addUtcDays(date, -1))) {
        currentStreak += 1;
        date = addUtcDays(date, -1);
      }
    }

    return {
      memberId,
      currentStreak,
      lastQualifyingDate,
      completedDates: uniqueDates,
    };
  }

  private ensureMemberCompletion(attempt: DailyAttempt): DailyCompletion {
    if (attempt.owner.kind !== "member") {
      throw new Error("Only a member-owned attempt can create member progress.");
    }

    const key = memberDateKey(attempt.owner.memberId, attempt.challengeDate);
    const existing = this.completionsByMemberDate.get(key);
    if (existing) {
      return existing;
    }

    const previousDate = addUtcDays(attempt.challengeDate, -1);
    const previous = this.completionsByMemberDate.get(
      memberDateKey(attempt.owner.memberId, previousDate),
    );
    const streak = previous && isNextUtcDay(previous.challengeDate, attempt.challengeDate)
      ? previous.streak + 1
      : 1;
    const reward = this.rewardsByMemberDate.get(key) ?? {
      id: randomUUID(),
      memberId: attempt.owner.memberId,
      challengeDate: attempt.challengeDate,
      points: 1,
    };
    this.rewardsByMemberDate.set(key, reward);

    const completion: DailyCompletion = {
      id: randomUUID(),
      attemptId: attempt.id,
      memberId: attempt.owner.memberId,
      challengeDate: attempt.challengeDate,
      completedAt: attempt.completedAt ?? new Date(),
      streak,
      reward,
    };
    this.completionsByMemberDate.set(key, completion);
    return completion;
  }

  private requireAttempt(attemptId: string): DailyAttempt {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) {
      throw new Error(`Attempt "${attemptId}" was not found.`);
    }
    return attempt;
  }
}

function memberDateKey(memberId: string, challengeDate: CanonicalDate): string {
  assertCanonicalDate(challengeDate);
  return `${memberId}:${challengeDate}`;
}

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A valid instant is required.");
  }
  return date;
}

function cloneOwner(owner: DailyOwner): DailyOwner {
  return owner.kind === "member"
    ? { kind: "member", memberId: owner.memberId }
    : { kind: "guest", guestId: owner.guestId };
}

function cloneAttempt(attempt: DailyAttempt): DailyAttempt {
  return {
    ...attempt,
    issuedAt: new Date(attempt.issuedAt.getTime()),
    owner: cloneOwner(attempt.owner),
    ...(attempt.completedAt
      ? { completedAt: new Date(attempt.completedAt.getTime()) }
      : {}),
  };
}

function cloneReward(reward: DailyReward): DailyReward {
  return { ...reward };
}

function cloneCompletion(completion: DailyCompletion): DailyCompletion {
  return {
    ...completion,
    completedAt: new Date(completion.completedAt.getTime()),
    reward: cloneReward(completion.reward),
  };
}