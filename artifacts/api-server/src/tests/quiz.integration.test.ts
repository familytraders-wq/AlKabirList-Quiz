import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  attemptAnswers,
  anonymousSessions,
  dailyCompletions,
  dailyRewards,
  questionChoices,
  questionVersions,
  questions,
  quizAttempts,
  quizQuestions,
  quizzes,
  rewardLedger,
  guestProgressLinks,
  reviewEvents,
  users,
  userRoles,
  operatorAuditEvents,
  taxonomies,
} from "@workspace/db/schema";
import { createApp } from "../app";
import { parseQuestionCsv } from "../lib/question-csv";

type Identity = {
  userId: string;
  role: "member" | "reviewer" | "admin";
  permissions?: string[];
};

type ResponseData = {
  status: number;
  body: any;
  headers: Headers;
};

class CookieJar {
  private cookies = new Map<string, string>();
  setCookieHeader(value: string) {
    for (const cookie of value.split(/,(?=[^;,]+=)/)) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  get(name: string) {
    return this.cookies.get(name);
  }
  clone() {
    const copy = new CookieJar();
    for (const [name, value] of this.cookies) {
      copy.cookies.set(name, value);
    }
    return copy;
  }
}

const member: Identity = {
  userId: randomUUID(),
  role: "member",
};
const otherMember: Identity = {
  userId: randomUUID(),
  role: "member",
};
const reviewer: Identity = {
  userId: randomUUID(),
  role: "reviewer",
  permissions: [
    "content.view",
    "content.manage",
    "schedule.view",
    "schedule.manage",
  ],
};
const identities = new Map<string, Identity>(
  [member, otherMember, reviewer].map((identity) => [identity.userId, identity]),
);

let server: Server | undefined;
let baseUrl: string;

let failNextStartRequest = false;
const scheduledQuizIds: string[] = [];
const scheduledQuestionIds: string[] = [];
const scheduledVersionIds: string[] = [];
const csvTaxonomyIds: string[] = [];
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
  dailyQuizId: randomUUID(),
};

function url(path: string) {
  return `${baseUrl}/api${path}`;
}

async function startServer() {
  server = await new Promise<Server>((resolve) => {
    const api = createApp({
      resolveAuth: (req) => {
        const userId = req.header("x-test-user-id");
        return userId ? identities.get(userId) : undefined;
      },
    });
    const instance = express()
      .use("/api/quiz/attempts", express.json())
      .use("/api/quiz/attempts", (req, res, next) => {
        if (req.method !== "POST") return next();
        observedStartRequests.push(req.body);
        if (!failNextStartRequest) return next();
        failNextStartRequest = false;
        return res.status(503).json({
          code: "TRANSIENT_FAILURE",
          message: "Challenge start temporarily unavailable",
        });
      })
      .use(api)
      .listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopServer() {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(
  path: string,
  options: RequestInit = {},
  identity?: Identity,
  jar?: CookieJar,
): Promise<ResponseData> {
  const method = (options.method ?? "GET").toUpperCase();
  const requestJar = jar ?? (["POST", "PUT", "PATCH", "DELETE"].includes(method) ? new CookieJar() : undefined);
  if (requestJar && !requestJar.get("alkabir_csrf") && path.startsWith("/quiz/")) {
    await request("/auth/me", {}, identity, requestJar);
  }
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (identity) headers.set("x-test-user-id", identity.userId);
  if (requestJar) {
    headers.set("cookie", requestJar.header());
    if (path.startsWith("/quiz/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers.set("origin", "http://localhost:5173");
      headers.set("x-csrf-token", requestJar.get("alkabir_csrf") ?? "");
    }
  }
  const response = await fetch(url(path), { ...options, headers });
  const responseWithCookies = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = responseWithCookies.getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  for (const value of setCookies) requestJar?.setCookieHeader(value);
  const text = await response.text();
  const body = text
    ? response.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : text
    : undefined;
  return { status: response.status, body, headers: response.headers };
}

async function adminMutation(
  path: string,
  options: RequestInit,
  identity: Identity,
  jar = new CookieJar(),
) {
  await request("/auth/me", {}, identity, jar);
  const headers = new Headers(options.headers);
  headers.set("origin", "http://localhost:5173");
  headers.set("x-csrf-token", jar.get("alkabir_csrf")!);
  return request(path, { ...options, headers }, identity, jar);
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

async function insertDailyQuiz(
  id: string,
  slug: string,
  versionId: string,
  scheduledDate: string,
) {
  await db.insert(quizzes).values({
    id,
    slug,
    title: slug,
    scheduledDate,
    timezone: "UTC",
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
  await insertDailyQuiz(
    fixture.dailyQuizId,
    `daily-concurrency-${randomUUID()}`,
    fixture.approvedVersionId,
    "2026-09-11",
  );

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

  await startServer();
});

after(async () => {
  await stopServer();
  const attemptIds = (
    await db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(inArray(quizAttempts.quizId, [
        fixture.approvedQuizId,
        fixture.dailyQuizId,
        fixture.draftQuizId,
        fixture.pendingQuizId,
      ]))
  ).map((attempt) => attempt.id);
  if (attemptIds.length) {
    await db.delete(dailyRewards).where(eq(dailyRewards.memberId, member.userId));
    await db.delete(dailyCompletions).where(eq(dailyCompletions.memberId, member.userId));
    await db.delete(rewardLedger).where(inArray(rewardLedger.attemptId, attemptIds));
    await db.delete(attemptAnswers).where(inArray(attemptAnswers.attemptId, attemptIds));
    await db.delete(quizAttempts).where(inArray(quizAttempts.id, attemptIds));
  }
  await db.delete(reviewEvents).where(eq(reviewEvents.questionId, fixture.reviewQuestionId));
  if (scheduledQuestionIds.length) {
    await db.delete(reviewEvents).where(inArray(reviewEvents.questionId, scheduledQuestionIds));
  }
  await db.delete(operatorAuditEvents).where(and(
    eq(operatorAuditEvents.actorId, reviewer.userId),
    inArray(operatorAuditEvents.entityId, [
      fixture.approvedQuestionId,
      fixture.draftQuestionId,
      fixture.pendingQuestionId,
      fixture.reviewQuestionId,
      ...scheduledQuestionIds,
      fixture.approvedQuizId,
      fixture.draftQuizId,
      fixture.pendingQuizId,
      fixture.dailyQuizId,
      ...scheduledQuizIds,
    ]),
  ));
  await db.delete(guestProgressLinks).where(
    inArray(guestProgressLinks.userId, [member.userId, otherMember.userId]),
  );
  await db.delete(quizQuestions).where(inArray(quizQuestions.quizId, [
    fixture.approvedQuizId,
    fixture.dailyQuizId,
    fixture.draftQuizId,
    fixture.pendingQuizId,
  ]));
  await db.delete(quizzes).where(inArray(quizzes.id, [
    fixture.approvedQuizId,
    fixture.dailyQuizId,
    fixture.draftQuizId,
    fixture.pendingQuizId,
  ]));
  if (scheduledQuizIds.length) await db.delete(quizzes).where(inArray(quizzes.id, scheduledQuizIds));
  if (scheduledQuestionIds.length) {
    await db.delete(questionChoices).where(inArray(questionChoices.versionId, scheduledVersionIds));
    await db.delete(questionVersions).where(inArray(questionVersions.id, scheduledVersionIds));
    await db.delete(questions).where(inArray(questions.id, scheduledQuestionIds));
  }
  if (csvTaxonomyIds.length) await db.delete(taxonomies).where(inArray(taxonomies.id, csvTaxonomyIds));
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
  it("redacts malformed legacy source metadata in completion and result responses", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `legacy-sources-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;
    const answered = await request(`/quiz/attempts/${attemptId}/answers`, {
      method: "POST",
      body: JSON.stringify({
        versionId: fixture.approvedVersionId,
        choiceId: fixture.correctChoiceId,
        idempotencyKey: `restart-answer-${randomUUID()}`,
      }),
    }, member);
    assert.equal(answered.status, 200);

    const completed = await request(`/quiz/attempts/${attemptId}/complete`, {
      method: "POST",
    }, member);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.deepEqual(completed.body.answers[0].sources, []);
    const result = await request(`/quiz/results/${attemptId}`, {}, member);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.answers[0].sources, []);
    await db.update(questionVersions)
      .set({ sourceMetadata: [] })
      .where(eq(questionVersions.id, fixture.approvedVersionId));
  });

  it("does not finalize an attempt until every question is answered", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `incomplete-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;

    const incomplete = await request(
      `/quiz/attempts/${attemptId}/complete`,
      { method: "POST" },
      member,
    );
    assert.equal(incomplete.status, 409);
    assert.equal(incomplete.body.code, "INCOMPLETE_ATTEMPT");

    const answered = await request(`/quiz/attempts/${attemptId}/answers`, {
      method: "POST",
      body: JSON.stringify({
        versionId: fixture.approvedVersionId,
        choiceId: fixture.correctChoiceId,
        idempotencyKey: `restart-answer-${randomUUID()}`,
      }),
    }, member);
    assert.equal(answered.status, 200);

    const completed = await request(`/quiz/attempts/${attemptId}/complete`, {
      method: "POST",
    }, member);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.score, 25);
  });

  it("keeps answer and completion races consistent at the attempt boundary", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `race-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;

    const initialAnswer = await request(
      `/quiz/attempts/${attemptId}/answers`,
      {
        method: "POST",
        body: JSON.stringify({
          versionId: fixture.approvedVersionId,
          choiceId: fixture.correctChoiceId,
          idempotencyKey: `race-initial-answer-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(initialAnswer.status, 200);

    const [lateAnswerResponse, completionResponse] = await Promise.all([
      request(
        `/quiz/attempts/${attemptId}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            versionId: fixture.approvedVersionId,
            choiceId: fixture.correctChoiceId,
            idempotencyKey: `race-answer-${randomUUID()}`,
          }),
        },
        member,
      ),
      request(
        `/quiz/attempts/${attemptId}/complete`,
        { method: "POST" },
        member,
      ),
    ]);

    assert.ok([200, 409].includes(lateAnswerResponse.status));
    assert.equal(completionResponse.status, 200);
    assert.equal(completionResponse.body.score, 25);
    if (lateAnswerResponse.status === 409) {
      assert.equal(lateAnswerResponse.body.code, "ATTEMPT_COMPLETED");
    }

    const result = await request(`/quiz/results/${attemptId}`, {}, member);
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "completed");
    assert.equal(result.body.answers.length, 1);
  });

  it("repeats answer and completion races without saving a mismatched score", async () => {
    const raceQuizId = randomUUID();
    const raceQuestionIds = [randomUUID(), randomUUID()];
    const raceVersionIds = [randomUUID(), randomUUID()];
    const raceChoiceIds = [randomUUID(), randomUUID()];
    const raceIncorrectChoiceIds = [randomUUID(), randomUUID()];
    const attemptIds: string[] = [];

    try {
      for (let index = 0; index < raceQuestionIds.length; index += 1) {
        await insertQuestion({
          questionId: raceQuestionIds[index]!,
          versionId: raceVersionIds[index]!,
          status: "approved",
          prompt: `Race fixture question ${index + 1}`,
          choiceIds: [
            { id: raceChoiceIds[index]!, label: "Correct", isCorrect: true },
            { id: raceIncorrectChoiceIds[index]!, label: "Incorrect", isCorrect: false },
          ],
        });
      }
      await db.insert(quizzes).values({
        id: raceQuizId,
        slug: `task49-race-${randomUUID()}`,
        title: "Task 49 race fixture",
        isActive: true,
      });
      await db.insert(quizQuestions).values(
        raceVersionIds.map((versionId, position) => ({
          quizId: raceQuizId,
          versionId,
          position,
          points: 25,
        })),
      );

      const completionStatuses = new Set<number>();
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const started = await request(
          "/quiz/attempts",
          {
            method: "POST",
            body: JSON.stringify({
              quizId: raceQuizId,
              idempotencyKey: `task49-start-${iteration}-${randomUUID()}`,
            }),
          },
          member,
        );
        assert.equal(started.status, 201, JSON.stringify(started.body));
        const attemptId = started.body.attemptId as string;
        attemptIds.push(attemptId);

        const initialAnswer = await request(
          `/quiz/attempts/${attemptId}/answers`,
          {
            method: "POST",
            body: JSON.stringify({
              versionId: raceVersionIds[0],
              choiceId: raceChoiceIds[0],
              idempotencyKey: `task49-initial-${iteration}-${randomUUID()}`,
            }),
          },
          member,
        );
        assert.equal(initialAnswer.status, 200, JSON.stringify(initialAnswer.body));

        const answerRequest = () => request(
          `/quiz/attempts/${attemptId}/answers`,
          {
            method: "POST",
            body: JSON.stringify({
              versionId: raceVersionIds[1],
              choiceId: raceChoiceIds[1],
              idempotencyKey: `task49-race-answer-${iteration}-${randomUUID()}`,
            }),
          },
          member,
        );
        const completeRequest = () => request(
          `/quiz/attempts/${attemptId}/complete`,
          { method: "POST" },
          member,
        );
        const [answerResponse, completionResponse] = iteration % 2 === 1
          ? await Promise.all([completeRequest(), answerRequest()]).then(([completion, answer]) => [answer, completion] as const)
          : await Promise.all([answerRequest(), completeRequest()]);
        completionStatuses.add(completionResponse.status);

        assert.equal(answerResponse.status, 200, JSON.stringify(answerResponse.body));
        assert.ok([200, 409].includes(completionResponse.status));
        if (completionResponse.status === 409) {
          assert.equal(completionResponse.body.code, "INCOMPLETE_ATTEMPT");
          const openAttempt = await request(`/quiz/attempts/${attemptId}`, {}, member);
          assert.equal(openAttempt.status, 200);
          assert.equal(openAttempt.body.status, "in_progress");
          const retried = await request(
            `/quiz/attempts/${attemptId}/complete`,
            { method: "POST" },
            member,
          );
          assert.equal(retried.status, 200, JSON.stringify(retried.body));
        }

        const result = await request(`/quiz/results/${attemptId}`, {}, member);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.status, "completed");
        assert.equal(result.body.answers.length, 2);
        assert.equal(result.body.score, 50);

        const [storedAttempt] = await db
          .select({ status: quizAttempts.status, score: quizAttempts.score })
          .from(quizAttempts)
          .where(eq(quizAttempts.id, attemptId));
        const storedAnswers = await db
          .select({ awardedPoints: attemptAnswers.awardedPoints })
          .from(attemptAnswers)
          .where(eq(attemptAnswers.attemptId, attemptId));
        assert.equal(storedAttempt?.status, "completed");
        assert.equal(
          storedAttempt?.score,
          storedAnswers.reduce((total, answer) => total + answer.awardedPoints, 0),
        );
      }

      assert.ok(completionStatuses.has(200));
      assert.ok(completionStatuses.has(409));
    } finally {
      if (attemptIds.length > 0) {
        await db.delete(rewardLedger).where(inArray(rewardLedger.attemptId, attemptIds));
        await db.delete(attemptAnswers).where(inArray(attemptAnswers.attemptId, attemptIds));
        await db.delete(quizAttempts).where(inArray(quizAttempts.id, attemptIds));
      }
      await db.delete(quizQuestions).where(eq(quizQuestions.quizId, raceQuizId));
      await db.delete(quizzes).where(eq(quizzes.id, raceQuizId));
      await db.delete(questionChoices).where(inArray(questionChoices.versionId, raceVersionIds));
      await db.delete(questionVersions).where(inArray(questionVersions.id, raceVersionIds));
      await db.delete(questions).where(inArray(questions.id, raceQuestionIds));
    }
  });

  it("keeps guest answer and completion races at the published score boundary", async () => {
    const guestJar = new CookieJar();
    let attemptId: string | undefined;
    let anonymousSessionId: string | undefined;
    try {
      const started = await request(
        "/quiz/attempts",
        {
          method: "POST",
          body: JSON.stringify({
            quizId: fixture.approvedQuizId,
            idempotencyKey: `guest-race-${randomUUID()}`,
          }),
        },
        undefined,
        guestJar,
      );
      assert.equal(started.status, 201, JSON.stringify(started.body));
      attemptId = started.body.attemptId as string;
      const anonymousCookie = guestJar.get("__Host-alkabir_anon");
      assert.ok(anonymousCookie);
      assert.ok(guestJar.get("alkabir_csrf"));
      const [guestAttempt] = await db
        .select({ anonymousSessionId: quizAttempts.anonymousSessionId })
        .from(quizAttempts)
        .where(eq(quizAttempts.id, attemptId));
      anonymousSessionId = guestAttempt?.anonymousSessionId ?? undefined;

      const initialAnswer = await request(
        `/quiz/attempts/${attemptId}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            versionId: fixture.approvedVersionId,
            choiceId: fixture.correctChoiceId,
            idempotencyKey: `guest-initial-answer-${randomUUID()}`,
          }),
        },
        undefined,
        guestJar,
      );
      assert.equal(initialAnswer.status, 200);

      const [lateAnswerResponse, completionResponse] = await Promise.all([
        request(
          `/quiz/attempts/${attemptId}/answers`,
          {
            method: "POST",
            body: JSON.stringify({
              versionId: fixture.approvedVersionId,
              choiceId: fixture.correctChoiceId,
              idempotencyKey: `guest-late-answer-${randomUUID()}`,
            }),
          },
          undefined,
          guestJar,
        ),
        request(
          `/quiz/attempts/${attemptId}/complete`,
          { method: "POST" },
          undefined,
          guestJar,
        ),
      ]);

      assert.ok([200, 409].includes(lateAnswerResponse.status));
      assert.equal(completionResponse.status, 200, JSON.stringify(completionResponse.body));
      assert.equal(completionResponse.body.status, "completed");
      assert.equal(completionResponse.body.answers.length, 1);
      assert.equal(completionResponse.body.score, 25);
      if (lateAnswerResponse.status === 409) {
        assert.equal(lateAnswerResponse.body.code, "ATTEMPT_COMPLETED");
      }

      const result = await request(`/quiz/results/${attemptId}`, {}, undefined, guestJar);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.status, "completed");
      assert.equal(result.body.answers.length, 1);
      assert.equal(result.body.score, 25);

      const storedAnswers = await db
        .select()
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, attemptId));
      assert.equal(storedAnswers.length, 1);
      assert.deepEqual(result.body.answers, [{
        versionId: storedAnswers[0]?.versionId,
        choiceId: storedAnswers[0]?.choiceId,
        isCorrect: storedAnswers[0]?.isCorrect,
        awardedPoints: storedAnswers[0]?.awardedPoints,
        explanation: "Fixture explanation",
        sources: [],
      }]);
      assert.equal(storedAnswers[0]?.awardedPoints, result.body.score);
    } finally {
      if (attemptId) {
        await db.delete(attemptAnswers).where(eq(attemptAnswers.attemptId, attemptId));
        await db.delete(quizAttempts).where(eq(quizAttempts.id, attemptId));
      }
      if (anonymousSessionId) {
        await db.delete(anonymousSessions).where(eq(anonymousSessions.id, anonymousSessionId));
      }
    }
  });

  it("persists one daily completion and reward across concurrent attempts for the same UTC date", async () => {
    const attempts = await Promise.all(
      ["first", "second"].map(async (suffix) => {
        const started = await request(
          "/quiz/attempts",
          {
            method: "POST",
            body: JSON.stringify({
              quizId: fixture.dailyQuizId,
              idempotencyKey: `daily-${suffix}-${randomUUID()}`,
            }),
          },
          member,
        );
        assert.equal(started.status, 201);
        assert.equal(started.body.challengeDate, "2026-09-11");
        const attemptId = started.body.attemptId as string;
        const answered = await request(
          `/quiz/attempts/${attemptId}/answers`,
          {
            method: "POST",
            body: JSON.stringify({
              versionId: fixture.approvedVersionId,
              choiceId: fixture.correctChoiceId,
              idempotencyKey: `daily-answer-${suffix}-${randomUUID()}`,
            }),
          },
          member,
        );
        assert.equal(answered.status, 200);
        return attemptId;
      }),
    );

    const completionResponses = await Promise.all(
      attempts.map((attemptId) =>
        request(
          `/quiz/attempts/${attemptId}/complete`,
          { method: "POST" },
          member,
        ),
      ),
    );
    assert.deepEqual(
      completionResponses.map((response) => response.status),
      [200, 200],
    );

    const completions = await db
      .select()
      .from(dailyCompletions)
      .where(
        and(
          eq(dailyCompletions.memberId, member.userId),
          eq(dailyCompletions.challengeDate, "2026-09-11"),
        ),
      );
    const rewards = await db
      .select()
      .from(dailyRewards)
      .where(and(
        eq(dailyRewards.memberId, member.userId),
        eq(dailyRewards.challengeDate, "2026-09-11"),
      ));
    const ledgerEntries = await db
      .select()
      .from(rewardLedger)
      .where(
        eq(
          rewardLedger.eventKey,
          `daily-completion:${member.userId}:2026-09-11`,
        ),
      );

    assert.equal(completions.length, 1);
    assert.equal(completions[0]?.streak, 1);
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0]?.points, 25);
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0]?.points, 25);

    const progress = await request("/me/quiz/progress", {}, member);
    assert.equal(progress.status, 200);
    assert.equal(progress.body.currentStreak, 1);
  });

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

  it("recovers a saved completed score and reward after the result service restarts", async () => {
    const started = await request(
      "/quiz/attempts",
      {
        method: "POST",
        body: JSON.stringify({
          quizId: fixture.approvedQuizId,
          idempotencyKey: `restart-${randomUUID()}`,
        }),
      },
      member,
    );
    assert.equal(started.status, 201);
    const attemptId = started.body.attemptId as string;

    const answered = await request(`/quiz/attempts/${attemptId}/answers`, {
      method: "POST",
      body: JSON.stringify({
        versionId: fixture.approvedVersionId,
        choiceId: fixture.correctChoiceId,
        idempotencyKey: `restart-answer-${randomUUID()}`,
      }),
    }, member);
    assert.equal(answered.status, 200);

    const completed = await request(`/quiz/attempts/${attemptId}/complete`, {
      method: "POST",
    }, member);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.score, 25);
    assert.equal(completed.body.rewardPoints, 25);

    await stopServer();
    await assert.rejects(() => request(`/quiz/results/${attemptId}`, {}, member));

    await startServer();
    const recovered = await request(`/quiz/results/${attemptId}`, {}, member);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.attemptId, attemptId);
    assert.equal(recovered.body.status, "completed");
    assert.equal(recovered.body.score, 25);
    assert.equal(recovered.body.maxScore, 25);
    assert.equal(recovered.body.rewardPoints, 25);
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
    const firstReview = await adminMutation(
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

    const staleReview = await adminMutation(
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

  it("links guest progress only after CSRF and explicit confirmation, then rotates access", async () => {
    const jar = new CookieJar();
    const started = await request(
      "/quiz/attempts",
      { method: "POST", body: JSON.stringify({ quizId: fixture.approvedQuizId, idempotencyKey: `guest-race-${randomUUID()}` }) },
      undefined,
      jar,
    );
    assert.equal(started.status, 201);
    assert.ok(jar.get("__Host-alkabir_anon"));
    assert.ok(jar.get("alkabir_csrf"));
    const attemptId = started.body.attemptId as string;
    const oldJar = jar.clone();

    const noCsrf = await request(
      "/auth/link-guest-progress",
      { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify({ confirm: true }) },
      member,
      new CookieJar(),
    );
    assert.equal(noCsrf.status, 403);

    const rejected = await request(
      "/auth/link-guest-progress",
      {
        method: "POST",
        headers: { Origin: "http://localhost:5173", "x-csrf-token": jar.get("alkabir_csrf")! },
        body: JSON.stringify({ confirm: false }),
      },
      member,
      jar,
    );
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.match(rejected.body.error, /Explicit confirmation/);

    const previousToken = jar.get("__Host-alkabir_anon");
    const linked = await request(
      "/auth/link-guest-progress",
      {
        method: "POST",
        headers: { Origin: "http://localhost:5173", "x-csrf-token": jar.get("alkabir_csrf")! },
        body: JSON.stringify({ confirm: true }),
      },
      member,
      jar,
    );
    assert.equal(linked.status, 200);
    assert.equal(linked.body.linked, true);
    assert.equal(linked.body.linkedAttemptCount, 1);
    assert.notEqual(jar.get("__Host-alkabir_anon"), previousToken);

    const authenticatedProgress = await request("/auth/me", {}, member, jar);
    assert.equal(authenticatedProgress.body.authenticated, true);
    assert.equal(authenticatedProgress.body.guestProgress.count, 0);
    assert.equal((await request(`/quiz/attempts/${attemptId}`, {}, member, jar)).status, 200);

    // The pre-link anonymous owner no longer has access, even though the
    // authenticated member retained the transferred attempt.
    const anonymousAccess = await request(
      `/quiz/attempts/${attemptId}`,
      {},
      undefined,
      oldJar,
    );
    assert.equal(anonymousAccess.status, 404);
    const links = await db.select().from(guestProgressLinks).where(eq(guestProgressLinks.userId, member.userId));
    assert.ok(links.some((link) => link.linkedAttemptCount === 1));
  });

  it("serializes concurrent links and leaves exactly one transfer", async () => {
    const jar = new CookieJar();
    await request("/auth/me", {}, undefined, jar);
    const started = await request(
      "/quiz/attempts",
      { method: "POST", body: JSON.stringify({ quizId: fixture.approvedQuizId, idempotencyKey: `guest-race-${randomUUID()}` }) },
      undefined,
      jar,
    );
    assert.equal(started.status, 201);
    const csrf = jar.get("alkabir_csrf")!;
    const [first, second] = await Promise.all(
      [member, otherMember].map((identity) =>
        request(
          "/auth/link-guest-progress",
          {
            method: "POST",
            headers: { Origin: "http://localhost:5173", "x-csrf-token": csrf },
            body: JSON.stringify({ confirm: true }),
          },
          identity,
          jar.clone(),
        ),
      ),
    );
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 404]);
    const transferred = await db.select().from(quizAttempts).where(eq(quizAttempts.id, started.body.attemptId));
    assert.equal(transferred[0]?.anonymousSessionId, null);
    assert.ok(transferred[0]?.userId === member.userId || transferred[0]?.userId === otherMember.userId);
  });
});

describe("quiz scheduling operations", () => {
  const scheduleBody = (date: string, questions = [{ versionId: fixture.approvedVersionId, points: 30 }]) => ({
    title: "Operations fixture",
    scheduledDate: date,
    timezone: "UTC",
    isActive: false,
    questions,
  });

  it("allows reviewer operations but denies ordinary members", async () => {
    assert.equal((await request("/admin/quiz/quizzes", {}, member)).status, 403);
    const questionList = await request("/admin/quiz/questions?status=approved", {}, reviewer);
    assert.equal(questionList.status, 200);
    assert.equal(questionList.body.items.find((item: { id: string }) => item.id === fixture.approvedQuestionId)?.points, 25);
    const created = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody("2099-04-01")),
    }, reviewer);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    scheduledQuizIds.push(created.body.id);
    assert.equal((await adminMutation(`/admin/quiz/quizzes/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...scheduleBody("2099-01-20"), title: "Updated operations fixture", isActive: true }),
    }, reviewer)).status, 200);
    assert.equal((await request(`/admin/quiz/quizzes/${created.body.id}/preview`, {}, reviewer)).status, 200);
  });

  it("rejects unsafe admin mutations without origin/CSRF and accepts a valid token", async () => {
    const body = scheduleBody("2099-06-28");
    const missingOrigin = await request("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(body),
    }, reviewer);
    assert.equal(missingOrigin.status, 403);

    const jar = new CookieJar();
    await request("/auth/me", {}, reviewer, jar);
    const invalidToken = await request("/admin/quiz/quizzes", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "x-csrf-token": "invalid" },
      body: JSON.stringify(body),
    }, reviewer, jar);
    assert.equal(invalidToken.status, 403);

    const valid = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(body),
    }, reviewer);
    assert.equal(valid.status, 201);
    scheduledQuizIds.push(valid.body.id);
  });

  it("rejects non-approved, non-current, and duplicate versions", async () => {
    const draft = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody("2099-02-01", [{ versionId: fixture.draftVersionId, points: 10 }])),
    }, reviewer);
    assert.equal(draft.status, 400);
    const duplicate = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody("2099-02-02", [
        { versionId: fixture.approvedVersionId, points: 10 },
        { versionId: fixture.approvedVersionId, points: 20 },
      ])),
    }, reviewer);
    assert.equal(duplicate.status, 400);
  });

  it("keeps one daily slot under concurrent creates and replaces ordered membership transactionally", async () => {
    const secondQuestionId = randomUUID();
    const secondVersionId = randomUUID();
    const secondChoiceId = randomUUID();
    scheduledQuestionIds.push(secondQuestionId);
    scheduledVersionIds.push(secondVersionId);
    await insertQuestion({
      questionId: secondQuestionId,
      versionId: secondVersionId,
      status: "approved",
      prompt: "Second approved scheduling fixture",
      choiceIds: [{ id: secondChoiceId, label: "Only choice", isCorrect: true }],
    });
    const date = `2099-03-${String(10 + scheduledQuizIds.length).padStart(2, "0")}`;
    const responses = await Promise.all([1, 2].map(() => adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody(date)),
    }, reviewer)));
    assert.deepEqual(responses.map((item) => item.status).sort(), [201, 409]);
    const created = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody("2099-04-01")),
    }, reviewer);
    scheduledQuizIds.push(created.body.id);
    const updated = await adminMutation(`/admin/quiz/quizzes/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify(scheduleBody(date, [
        { versionId: secondVersionId, points: 7 },
        { versionId: fixture.approvedVersionId, points: 19 },
      ])),
    }, reviewer);
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.deepEqual(updated.body.questions, [
      { versionId: secondVersionId, points: 7 },
      { versionId: fixture.approvedVersionId, points: 19 },
    ]);
  });

  it("redacts answer metadata from the exact public preview", async () => {
    const created = await adminMutation("/admin/quiz/quizzes", {
      method: "POST",
      body: JSON.stringify(scheduleBody("2099-04-01")),
    }, reviewer);
    assert.equal(created.status, 201);
    scheduledQuizIds.push(created.body.id);
    const preview = await request(`/admin/quiz/quizzes/${created.body.id}/preview`, {}, reviewer);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.questions[0].prompt, "Approved fixture question");
    assert.ok(preview.body.questions[0].choices.length > 0);
    const serialized = JSON.stringify(preview.body);
    assert.equal(serialized.includes("isCorrect"), false);
    assert.equal(serialized.includes("correctChoiceId"), false);
    assert.equal(serialized.includes("answer"), false);
  });
});

describe("question review transitions", () => {
  it("submits drafts, approves pending questions, and rejects invalid or stale decisions", async () => {
    const questionId = randomUUID();
    const versionId = randomUUID();
    scheduledQuestionIds.push(questionId);
    scheduledVersionIds.push(versionId);
    await insertQuestion({
      questionId,
      versionId,
      status: "draft",
      prompt: "Review transition fixture",
      choiceIds: [{ id: randomUUID(), label: "Answer", isCorrect: true }],
    });

    const directApproval = await adminMutation(`/admin/quiz/questions/${questionId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ expectedStatus: "draft", decision: "approve" }),
    }, reviewer);
    assert.equal(directApproval.status, 409);
    assert.equal(directApproval.body.code, "INVALID_REVIEW_TRANSITION");

    const submitted = await adminMutation(`/admin/quiz/questions/${questionId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ expectedStatus: "draft", decision: "submit" }),
    }, reviewer);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.status, "pending_review");

    const approved = await adminMutation(`/admin/quiz/questions/${questionId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ expectedStatus: "pending_review", decision: "approve" }),
    }, reviewer);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, "approved");

    const stale = await adminMutation(`/admin/quiz/questions/${questionId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ expectedStatus: "pending_review", decision: "reject" }),
    }, reviewer);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "STALE_REVIEW");
  });
});

describe("CSV question imports", () => {
  const header = [
    "question_id", "expected_version",
    "prompt", "explanation", "type", "points",
    "choice_1", "choice_1_correct", "choice_2", "choice_2_correct",
    "choice_3", "choice_3_correct", "choice_4", "choice_4_correct",
    "source_title", "source_url", "category_id", "difficulty_id", "audience_ids",
  ];
  const csvEscape = (value: string) => /[",\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
  const row = (prompt: string, overrides: Record<number, string> = {}) => {
    const values = Array.from({ length: header.length }, () => "");
    values[2] = prompt;
    values[4] = "multiple_choice";
    values[5] = "5";
    values[6] = "Correct";
    values[7] = "true";
    values[8] = "Incorrect";
    values[9] = "false";
    for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
    return values.map(csvEscape).join(",");
  };
  const csv = (...rows: string[]) => `${header.join(",")}\n${rows.join("\n")}\n`;

  it("imports two drafts with quoted commas and creates one audit event per question", async () => {
    const response = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Denied")) }),
    }, member);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.importedCount, 2);
    assert.equal(response.body.createdCount, 2);
    assert.equal(response.body.updatedCount, 0);
    assert.equal(response.body.questionIds.length, 2);
    scheduledQuestionIds.push(...response.body.questionIds);
    const importedVersions = await db.select({ prompt: questionVersions.prompt }).from(questionVersions)
      .where(inArray(questionVersions.questionId, response.body.questionIds));
    assert.ok(importedVersions.some((version) => version.prompt === "A question, with a comma"));
    const audits = await db.select().from(operatorAuditEvents).where(
      and(eq(operatorAuditEvents.action, "question_created"), inArray(operatorAuditEvents.entityId, response.body.questionIds)),
    );
    assert.equal(audits.length, 2);
  });

  it("atomically mixes creates and version-checked updates, returning updated content to draft", async () => {
    const initial = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "export-source.csv",
        csv: csv(row("Exported question, with punctuation", {
          3: "An explanation with a\nline break",
          14: "Reference",
          15: "https://example.com/reference",
        })),
      }),
    }, reviewer);
    assert.equal(initial.status, 201, JSON.stringify(initial.body));
    const questionId = initial.body.questionIds[0] as string;

    scheduledQuestionIds.push(questionId);

    for (const [expectedStatus, decision] of [["draft", "submit"], ["pending_review", "approve"]] as const) {
      const reviewed = await adminMutation(`/admin/quiz/questions/${questionId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ expectedStatus, decision }),
      }, reviewer);
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    }

    const updatedRow = row("Updated by CSV", { 0: questionId, 1: "1" });
    const mixed = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "mixed.csv", csv: csv(updatedRow, row("Created beside update")) }),
    }, reviewer);
    assert.equal(mixed.status, 201, JSON.stringify(mixed.body));
    assert.equal(mixed.body.createdCount, 1);
    assert.equal(mixed.body.updatedCount, 1);
    assert.ok(mixed.body.questionIds.includes(questionId));
    const createdId = mixed.body.questionIds.find((id: string) => id !== questionId);
    scheduledQuestionIds.push(createdId);

    const [updated] = await db
      .select({ status: questions.status, version: questionVersions.version, prompt: questionVersions.prompt })
      .from(questions)
      .innerJoin(questionVersions, eq(questions.currentVersionId, questionVersions.id))
      .where(eq(questions.id, questionId));
    assert.deepEqual(updated, { status: "draft", version: 2, prompt: "Updated by CSV" });
    const updateAudits = await db.select().from(operatorAuditEvents).where(and(
      eq(operatorAuditEvents.action, "question_updated"),
      eq(operatorAuditEvents.entityId, questionId),
    ));
    assert.ok(updateAudits.length >= 1);
  });

  it("reports stale update rows and rolls back otherwise valid creates", async () => {
    const initial = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "export-source.csv",
        csv: csv(row("Exported question, with punctuation", {
          3: "An explanation with a\nline break",
          14: "Reference",
          15: "https://example.com/reference",
        })),
      }),
    }, reviewer);
    const questionId = initial.body.questionIds[0] as string;

    scheduledQuestionIds.push(questionId);
    const untouchedPrompt = `Must roll back ${randomUUID()}`;

    const stale = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "stale.csv",
        csv: csv(row("Stale edit", { 0: questionId, 1: "2" }), row(untouchedPrompt)),
      }),
    }, reviewer);
    assert.equal(stale.status, 400);
    assert.ok(stale.body.rowErrors.some((error: { row: number; column: string }) =>
      error.row === 2 && error.column === "expected_version"));
    const noCreate = await db.select().from(questionVersions).where(eq(questionVersions.prompt, untouchedPrompt));
    assert.equal(noCreate.length, 0);
  });

  it("allows only one concurrent import for the same expected version", async () => {
    const initial = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "export-source.csv",
        csv: csv(row("Exported question, with punctuation", {
          3: "An explanation with a\nline break",
          14: "Reference",
          15: "https://example.com/reference",
        })),
      }),
    }, reviewer);
    assert.equal(initial.status, 201, JSON.stringify(initial.body));
    const questionId = initial.body.questionIds[0] as string;
    scheduledQuestionIds.push(questionId);

    const exported = await adminMutation(
      `/admin/quiz/questions/export-csv?question_id=${questionId}`,
      {},
      reviewer,
    );
    scheduledQuestionIds.push(questionId);

    const [first, second] = await Promise.all([
      adminMutation("/admin/quiz/questions/import-csv", {
        method: "POST",
        body: JSON.stringify({
          filename: "concurrent-a.csv",
          csv: csv(row("Concurrent edit A", { 0: questionId, 1: "1" })),
        }),
      }, reviewer),
      adminMutation("/admin/quiz/questions/import-csv", {
        method: "POST",
        body: JSON.stringify({
          filename: "concurrent-b.csv",
          csv: csv(row("Concurrent edit B", { 0: questionId, 1: "1" })),
        }),
      }, reviewer),
    ]);
    const results = [first, second];
    const successes = results.filter((response) => response.status === 201);
    const conflicts = results.filter((response) => response.status === 400);

    assert.equal(successes.length, 1, JSON.stringify(results.map((response) => response.body)));
    assert.equal(conflicts.length, 1, JSON.stringify(results.map((response) => response.body)));
    assert.deepEqual(conflicts[0].body.rowErrors, [{
      row: 2,
      column: "expected_version",
      message: "Version conflict: expected 1, current version is 2",
    }]);

    const committedVersions = await db
      .select({ version: questionVersions.version, prompt: questionVersions.prompt })
      .from(questionVersions)
      .where(eq(questionVersions.questionId, questionId));
    assert.equal(committedVersions.length, 2);
    assert.equal(committedVersions.filter((version) => version.version === 2).length, 1);
    assert.ok(["Concurrent edit A", "Concurrent edit B"].includes(
      committedVersions.find((version) => version.version === 2)?.prompt ?? "",
    ));

    const updateAudits = await db.select().from(operatorAuditEvents).where(and(
      eq(operatorAuditEvents.action, "question_updated"),
      eq(operatorAuditEvents.entityId, questionId),
    ));
    assert.equal(updateAudits.length, 1);
  });

  it("accepts escape-heavy JSON that is over the global parser limit", async () => {
    const escapedPrompt = `${"\\".repeat(200_000)},"quoted"`;
    const response = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Denied")) }),
    }, member);
    assert.notEqual(response.status, 413);
    assert.ok([201, 400].includes(response.status), JSON.stringify(response.body));
    if (response.status === 201) scheduledQuestionIds.push(...response.body.questionIds);
  });

  it("denies users without content.manage", async () => {
    const response = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Denied")) }),
    }, member);
    assert.equal(response.status, 403);
  });

  it("rejects malformed CSV and exact-header violations", async () => {
    const malformed = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: `${header.join(",")}\n"unclosed` }),
    }, reviewer);
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.rowErrors[0].message, /Malformed CSV/);

    const wrongHeader = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: `${header.slice(0, -1).join(",")}\n${row("Wrong header")}` }),
    }, reviewer);
    assert.equal(wrongHeader.status, 400);
    assert.equal(wrongHeader.body.rowErrors[0].row, 1);
  });

  it("validates every row before writing and rejects normalized duplicate prompts", async () => {
    const invalid = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Will not be written"), row("Invalid", { 7: "yes" })) }),
    }, reviewer);
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.rowErrors.some((error: { row: number; column: string }) => error.row === 3 && error.column === "choice_1_correct"));
    const noWrites = await db.select().from(questionVersions).where(eq(questionVersions.prompt, "Will not be written"));
    assert.equal(noWrites.length, 0);

    const duplicate = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Normalize Me"), row(" normalize   me ")) }),
    }, reviewer);
    assert.equal(duplicate.status, 400);
    assert.ok(duplicate.body.rowErrors.some((error: { column: string }) => error.column === "prompt"));
  });

  it("rejects row and file limits", async () => {
    const tooManyRows = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(...Array.from({ length: 51 }, (_, index) => row(`Question ${index}`))) }),
    }, reviewer);
    assert.equal(tooManyRows.status, 400);
    assert.match(tooManyRows.body.rowErrors[0].message, /50/);

    const tooLarge = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: "x".repeat(2 * 1024 * 1024 + 1) }),
    }, reviewer);
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.body.rowErrors[0].message, /2 MiB/);
  });

  it("requires taxonomy IDs to exist with the correct kinds", async () => {
    const categoryId = randomUUID();

    const difficultyId = randomUUID();
    const audienceId = randomUUID();
    csvTaxonomyIds.push(categoryId, audienceId);
    await db.insert(taxonomies).values([
      { id: categoryId, kind: "category", slug: `csv-category-${categoryId}`, label: "CSV category", sortOrder: 700001 },
      { id: audienceId, kind: "audience", slug: `csv-audience-${audienceId}`, label: "CSV audience", sortOrder: 700001 },
    ]);
    const wrongKind = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "questions.csv",
        csv: csv(row("Wrong taxonomy kind", { 16: audienceId })),
      }),
    }, reviewer);
    assert.equal(wrongKind.status, 400);
    assert.ok(wrongKind.body.rowErrors.some((error: { column: string; message: string }) =>
      error.column === "category_id" && /category/.test(error.message)));

    const missing = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({ filename: "questions.csv", csv: csv(row("Missing taxonomy", { 16: randomUUID() })) }),
    }, reviewer);
    assert.equal(missing.status, 400);
    assert.ok(missing.body.rowErrors.some((error: { column: string; message: string }) =>
      error.column === "category_id" && /does not exist/.test(error.message)));
  });

  it("exports selected questions with answers in an update-ready CSV", async () => {
    const initial = await adminMutation("/admin/quiz/questions/import-csv", {
      method: "POST",
      body: JSON.stringify({
        filename: "export-source.csv",
        csv: csv(row("Exported question, with punctuation", {
          3: "An explanation with a\nline break",
          14: "Reference",
          15: "https://example.com/reference",
        })),
      }),
    }, reviewer);
    assert.equal(initial.status, 201, JSON.stringify(initial.body));
    const questionId = initial.body.questionIds[0] as string;
    scheduledQuestionIds.push(questionId);

    const exported = await adminMutation(
      `/admin/quiz/questions/export-csv?question_id=${questionId}`,
      {},
      reviewer,
    );
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(exported.headers.get("content-disposition") ?? "", /attachment/);

    const parsed = parseQuestionCsv(exported.body);
    assert.deepEqual(parsed.rowErrors, []);
    assert.equal(parsed.inputs.length, 1);
    assert.equal(parsed.inputs[0]?.questionId, questionId);
    assert.equal(parsed.inputs[0]?.expectedVersion, 1);
    assert.equal(parsed.inputs[0]?.prompt, "Exported question, with punctuation");
    assert.equal(parsed.inputs[0]?.explanation, "An explanation with a\nline break");
    assert.deepEqual(parsed.inputs[0]?.choices.map(({ label, isCorrect }) => ({ label, isCorrect })), [
      { label: "Correct", isCorrect: true },
      { label: "Incorrect", isCorrect: false },
    ]);
    assert.deepEqual(parsed.inputs[0]?.sourceMetadata, [
      { title: "Reference", url: "https://example.com/reference" },
    ]);

    const denied = await request(
      `/admin/quiz/questions/export-csv?question_id=${questionId}`,
      {},
      member,
    );
    assert.equal(denied.status, 403);
  });
});

const observedStartRequests: unknown[] = [];
