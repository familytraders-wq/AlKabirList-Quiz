import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { questionChoices, questionVersions, questions, quizQuestions, quizzes } from "@workspace/db/schema";
import { createApp } from "../app";

const quizId = randomUUID();
const questionId = randomUUID();
const versionId = randomUUID();
const choiceId = randomUUID();
const today = new Date().toISOString().slice(0, 10);
let server: Server;
let baseUrl: string;

async function request(path: string) {
  const response = await fetch(`${baseUrl}/api${path}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

before(async () => {
  await db.insert(questions).values({ id: questionId, currentVersionId: versionId, status: "approved" });
  await db.insert(questionVersions).values({
    id: versionId, questionId, version: 1, prompt: "Private fixture prompt",
    explanation: "Private fixture explanation", sourceMetadata: [],
  });
  await db.insert(questionChoices).values({
    id: choiceId, versionId, label: "Private answer", position: 0, isCorrect: true,
  });
  await db.insert(quizzes).values({
    id: quizId, slug: `daily-contract-${randomUUID()}`, title: "Today's Challenge",
    scheduledDate: today, isActive: true,
  });
  await db.insert(quizQuestions).values({ quizId, versionId, position: 0, points: 10 });
  server = await new Promise<Server>((resolve) => {
    const instance = createApp().listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(quizQuestions).where(eq(quizQuestions.quizId, quizId));
  await db.delete(quizzes).where(eq(quizzes.id, quizId));
  await db.delete(questionChoices).where(eq(questionChoices.id, choiceId));
  await db.delete(questionVersions).where(eq(questionVersions.id, versionId));
  await db.delete(questions).where(eq(questions.id, questionId));
  await pool.end();
});

describe("daily challenge metadata", () => {
  it("resolves only the active current UTC challenge without answers", async () => {
    const result = await request("/quiz/daily");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      quizId, title: "Today's Challenge", scheduledDate: today, questionCount: 1,
    });
    assert.equal("questions" in result.body, false);
    assert.equal("prompt" in result.body, false);
    assert.equal("choices" in result.body, false);
  });

  it("excludes inactive and wrong-date challenges", async () => {
    await db.update(quizzes).set({ isActive: false }).where(eq(quizzes.id, quizId));
    assert.equal((await request("/quiz/daily")).status, 404);
    await db.update(quizzes).set({ isActive: true, scheduledDate: "2099-12-31" }).where(eq(quizzes.id, quizId));
    const result = await request("/quiz/daily");
    assert.equal(result.status, 404);
    assert.equal(result.body.code, "NO_DAILY_QUIZ");
  });
});