import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  attemptAnswers,
  questionChoices,
  questionVersions,
  questions,
  quizAttempts,
  quizQuestions,
  quizzes,
  rewardLedger,
  reviewEvents,
  users,
} from "@workspace/db/schema";
import { createApp } from "../app";

type Identity = {
  userId: string;
  role: "member" | "reviewer" | "admin";
};

type ResponseData = {
  status: number;
  body: any;
};

const member: Identity = {
  userId: `task13-member-${randomUUID()}`,
  role: "member",
};
const otherMember: Identity = {
  userId: `task13-other-${randomUUID()}`,
  role: "member",
};
const reviewer: Identity = {
  userId: `task13-reviewer-${randomUUID()}`,
  role: "reviewer",
};
const identities = new Map<string, Identity>(
  [member, otherMember, reviewer].map((identity) => [identity.userId, identity]),
);

let server: Server;
let baseUrl: string;
const fixture = {
  approvedQuizId: randomUUID(),
  approvedQuestionId: randomUUID(),
  approvedVersionId: randomUUID(),
  correctChoiceId: randomUUID(),
  incorrectChoiceId: randomUUID(),
  draftQuizId: randomUUID(),
  draftQuestionId: randomUUID(),
  draftVersionId: randomUUID(),
  pendingQuizId: randomUUID(),
  pendingQuestionId: randomUUID(),
  pendingVersionId: randomUUID(),
  reviewQuestionId: randomUUID(),
  reviewVersionId: randomUUID(),
  reviewChoiceId: randomUUID(),
};

function url(path: string) {
  return `${baseUrl}/api${path}`;
}

async function request(
  path: string,
  options: RequestInit = {},
  identity?: Identity,
): Promise<ResponseData> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (identity) headers.set("x-test-user-id", identity.userId);
  const response = await fetch(url(path), { ...options, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function insertQuestion(input: {
  questionId: string;
  versionId: string;
  status: "approved" | "draft" | "pending_review";
  prompt: string;
  choiceIds: Array<{ id: string; label: string; isCorrect: boolean }>;
}) {
  await db.insert(questions).values({
    id: input.questionId,
    status: input.status,
    currentVersionId: input.versionId,
    createdBy: reviewer.userId,
  });
  await db.insert(questionVersions).values({
    id: input.versionId,
    questionId: input.questionId,
    version: 1,
    prompt: input.prompt,
    explanation: "Fixture explanation",
    points: 25,
    createdBy: reviewer.userId,
    sourceMetadata: [],
  });
  await db.insert(questionChoices).values(
    input.choiceIds.map((choice, position) => ({
      id: choice.id,
      versionId: input.versionId,
      label: choice.label,
      position,
      isCorrect: choice.isCorrect,
    })),
  );
}

async function insertQuiz(id: string, slug: string, versionId: string) {
  await db.insert(quizzes).values({
    id,
    slug,
    title: slug,
    isActive: true,
  });
  await db.insert(quizQuestions).values({
    quizId: id,
    versionId,
    position: 0,
    points: 25,
  });
}

before(async () => {
  await db.insert(users).values([
    { id: member.userId, role: member.role },
    { id: otherMember.userId, role: otherMember.role },
    { id: reviewer.userId, role: reviewer.role },
  ]);
  await insertQuestion({
    questionId: fixture.approvedQuestionId,
    versionId: fixture.approvedVersionId,
    status: "approved",
    prompt: "Approved fixture question",
    choiceIds: [
      { id: fixture.correctChoiceId, label: "Correct", isCorrect: true },
      { id: fixture.incorrectChoiceId, label: "Incorrect", isCorrect: false },
    ],
  });
  await insertQuiz(fixture.approvedQuizId, `task13-approved-${randomUUID()}`, fixture.approvedVersionId);

  await insertQuestion({
    questionId: fixture.draftQuestionId,
    versionId: fixture.draftVersionId,
    status: "draft",
    prompt: "Draft fixture question",
    choiceIds: [{ id: randomUUID(), label: "Draft choice", isCorrect: true }],
  });
  await insertQuiz(fixture.draftQuizId, `task13-draft-${randomUUID()}`, fixture.draftVersionId);

  await insertQuestion({
    questionId: fixture.pendingQuestionId,
    versionId: fixture.pendingVersionId,
    status: "pending_review",
    prompt: "Pending fixture question",
    choiceIds: [{ id: randomUUID(), label: "Pending choice", isCorrect: true }],
  });
  await insertQuiz(fixture.pendingQuizId, `task13-pending-${randomUUID()}`, fixture.pendingVersionId);

  await insertQuestion({
    questionId: fixture.reviewQuestionId,
    versionId: fixture.reviewVersionId,
    status: "pending_review",
    prompt: "Review fixture question",
    choiceIds: [{ id: fixture.reviewChoiceId, label: "Review choice", isCorrect: true }],
  });

  await new Promise<void>((resolve) => {
    server = createApp({
      resolveAuth: (req) => {
        const userId = req.header("x-test-user-id");
        return userId ? identities.get(userId) : undefined;
      },
    }).listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  const attemptIds = (
    await db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(inArray(quizAttempts.quizId, [
        fixture.approvedQuizId,
        fixture.draftQuizId,
        fixture.pendingQuizId,
      ]))
  ).map((attempt) => attempt.id);
  if (attemptIds.length) {
    await db.delete(rewardLedger).where(inArray(rewardLedger.attemptId, attemptIds));
    await db.delete(attemptAnswers).where(inArray(attemptAnswers.attemptId, attemptIds));
    await db.delete(quizAttempts).where(inArray(quizAttempts.id, attemptIds));
  }
  await db.delete(reviewEvents).where(eq(reviewEvents.questionId, fixture.reviewQuestionId));
  await db.delete(quizQuestions).where(inArray(quizQuestions.quizId, [
    fixture.approvedQuizId,
    fixture.draftQuizId,
    fixture.pendingQuizId,
  ]));
  await db.delete(quizzes).where(inArray(quizzes.id, [
    fixture.approvedQuizId,
    fixture.draftQuizId,
    fixture.pendingQuizId,
  ]));
  await db.delete(questionChoices).where(inArray(questionChoices.versionId, [
    fixture.approvedVersionId,
    fixture.draftVersionId,
    fixture.pendingVersionId,
    fixture.reviewVersionId,
  ]));
  await db.delete(questionVersions).where(inArray(questionVersions.id, [
    fixture.approvedVersionId,
    fixture.draftVersionId,
    fixture.pendingVersionId,
    fixture.reviewVersionId,
  ]));
  await db.delete(questions).where(inArray(questions.id, [
    fixture.approvedQuestionId,
    fixture.draftQuestionId,
    fixture.pendingQuestionId,
    fixture.reviewQuestionId,
  ]));
  await db.delete(users).where(inArray(users.id, [
    member.userId,
    otherMember.userId,
    reviewer.userId,
  ]));
  await pool.end();
});

describe("quiz submission safety", () => {
  it("returns the original answer under duplicate requests and awards points once", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `start-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;

    const answerBody = {
      versionId: fixture.approvedVersionId,
      choiceId: fixture.correctChoiceId,
      idempotencyKey: `answer-${randomUUID()}`,
    };
    const duplicateAnswerBody = {
      ...answerBody,
      choiceId: fixture.incorrectChoiceId,
    };
    const answerResponses = await Promise.all([
      request(`/quiz/attempts/${attemptId}/answers`, {
        method: "POST",
        body: JSON.stringify(answerBody),
      }, member),
      request(`/quiz/attempts/${attemptId}/answers`, {
        method: "POST",
        body: JSON.stringify(duplicateAnswerBody),
      }, member),
    ]);
    assert.deepEqual(answerResponses[0].body, answerResponses[1].body);
    assert.equal(answerResponses[0].body.awardedPoints, 25);

    const storedAnswers = await db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, attemptId));
    assert.equal(storedAnswers.length, 1);
    assert.equal(storedAnswers[0]?.awardedPoints, 25);

    const completionResponses = await Promise.all([
      request(`/quiz/attempts/${attemptId}/complete`, { method: "POST" }, member),
      request(`/quiz/attempts/${attemptId}/complete`, { method: "POST" }, member),
    ]);
    assert.equal(completionResponses[0].status, 200);
    assert.equal(completionResponses[1].status, 200);
    assert.equal(completionResponses[0].body.score, 25);
    assert.equal(completionResponses[1].body.score, 25);

    const [storedAttempt] = await db
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attemptId));
    const rewards = await db
      .select()
      .from(rewardLedger)
      .where(and(
        eq(rewardLedger.userId, member.userId),
        eq(rewardLedger.attemptId, attemptId),
      ));
    assert.equal(storedAttempt?.status, "completed");
    assert.equal(storedAttempt?.score, 25);
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0]?.points, 25);
  });

  it("does not expose an attempt to another member and excludes draft or pending questions", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `owner-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;

    const unauthorized = await request(`/quiz/attempts/${attemptId}`, {}, otherMember);
    assert.equal(unauthorized.status, 404);

    for (const quizId of [fixture.draftQuizId, fixture.pendingQuizId]) {
      const response = await request(
        "/quiz/attempts",
        {
          method: "POST",
          body: JSON.stringify({
            quizId,
            idempotencyKey: `unpublished-${randomUUID()}`,
          }),
        },
        member,
      );
      assert.equal(response.status, 409);
      assert.equal(response.body.code, "NO_APPROVED_CONTENT");
    }
  });

  it("rejects a stale review without publishing the question", async () => {
    const firstReview = await request(
      `/admin/quiz/questions/${fixture.reviewQuestionId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedStatus: "pending_review",
          decision: "reject",
          note: "Fixture rejection",
        }),
      },
      reviewer,
    );
    assert.equal(firstReview.status, 200);

    const staleReview = await request(
      `/admin/quiz/questions/${fixture.reviewQuestionId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedStatus: "pending_review",
          decision: "approve",
        }),
      },
      reviewer,
    );
    assert.equal(staleReview.status, 409);
    assert.equal(staleReview.body.code, "STALE_REVIEW");

    const [question] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, fixture.reviewQuestionId));
    const events = await db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.questionId, fixture.reviewQuestionId));
    assert.equal(question?.status, "rejected");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.toStatus, "rejected");
  });
});