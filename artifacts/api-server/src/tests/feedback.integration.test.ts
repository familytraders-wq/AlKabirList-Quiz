import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  memberFeedback,
  operatorAuditEvents,
  questionChoices,
  questionVersions,
  questions,
  users,
} from "@workspace/db/schema";
import { createApp } from "../app";

type Identity = { userId: string; role: "member" | "reviewer" | "admin"; permissions?: string[] };
type Result = { status: number; body: any };
const complete = { userId: randomUUID(), role: "member" as const };
const incomplete = { userId: randomUUID(), role: "member" as const };
const reviewer = { userId: randomUUID(), role: "reviewer" as const };
const admin = { userId: randomUUID(), role: "admin" as const, permissions: ["access.view"] };
const identities = new Map<string, Identity>(
  [complete, incomplete, reviewer, admin].map((user) => [user.userId, user]),
);
const questionId = randomUUID();
const versionId = randomUUID();
const choiceId = randomUUID();
let server: Server;
let baseUrl: string;
const feedbackIds: string[] = [];

class Cookies {
  values = new Map<string, string>();
  add(value: string) {
    for (const cookie of value.split(/,(?=[^;,]+=)/)) {
      const pair = cookie.split(";")[0]!;
      const split = pair.indexOf("=");
      this.values.set(pair.slice(0, split), pair.slice(split + 1));
    }
  }
  header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function request(path: string, options: RequestInit = {}, user?: Identity, cookies?: Cookies): Promise<Result> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (user) headers.set("x-test-user-id", user.userId);
  if (cookies) headers.set("cookie", cookies.header());
  const response = await fetch(`${baseUrl}/api${path}`, { ...options, headers });
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = responseHeaders.getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  for (const setCookie of setCookies) cookies?.add(setCookie);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function mutation(path: string, body: unknown, user: Identity, cookies: Cookies, method = "POST") {
  await request("/auth/me", {}, user, cookies);
  return request(path, {
    method,
    headers: { origin: "http://localhost:5173", "x-csrf-token": cookies.values.get("alkabir_csrf") ?? "" },
    body: JSON.stringify(body),
  }, user, cookies);
}

before(async () => {
  await db.insert(users).values([
    { id: complete.userId, profileCompletedAt: new Date() },
    { id: incomplete.userId },
    { id: reviewer.userId },
    { id: admin.userId },
  ]);
  await db.insert(questions).values({ id: questionId, currentVersionId: versionId, createdBy: reviewer.userId });
  await db.insert(questionVersions).values({
    id: versionId, questionId, version: 1, prompt: "Fixture", explanation: "Fixture", createdBy: reviewer.userId, sourceMetadata: [],
  });
  await db.insert(questionChoices).values({ id: choiceId, versionId, label: "Choice", position: 0, isCorrect: true });
  server = await new Promise<Server>((resolve) => {
    const instance = createApp({
      resolveAuth: (req) => identities.get(req.header("x-test-user-id") ?? ""),
    }).listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(memberFeedback).where(inArray(memberFeedback.submitterId, [complete.userId, incomplete.userId]));
  await db.delete(operatorAuditEvents).where(and(
    inArray(operatorAuditEvents.actorId, [reviewer.userId, admin.userId]),
    inArray(operatorAuditEvents.entityId, feedbackIds),
  ));
  await db.delete(questionChoices).where(eq(questionChoices.versionId, versionId));
  await db.delete(questionVersions).where(eq(questionVersions.id, versionId));
  await db.delete(questions).where(eq(questions.id, questionId));
  await db.delete(users).where(inArray(users.id, [complete.userId, incomplete.userId, reviewer.userId, admin.userId]));
  await pool.end();
});

describe("production beta feedback security", () => {
  it("scopes member feedback, enforces profile completion, and derives question references", async () => {
    const cookies = new Cookies();
    const created = await mutation("/me/feedback", {
      kind: "question_accuracy", message: "Good question", questionVersionId: versionId,
    }, complete, cookies);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    feedbackIds.push(created.body.id);
    assert.equal(created.body.questionId, questionId);
    assert.equal((await request("/me/feedback", {}, complete)).body.total, 1);
    assert.equal((await request("/me/feedback", {}, incomplete)).body.total, 0);
    assert.equal((await request("/admin/beta/feedback", {}, complete)).status, 403);
    assert.equal((await mutation("/me/feedback", { kind: "general", message: "x" }, incomplete, new Cookies())).status, 403);

    const spoofed = await mutation("/me/feedback", {
      kind: "general", message: "no reference", questionId, questionVersionId: versionId,
    }, complete, new Cookies());
    assert.equal(spoofed.status, 201);
    feedbackIds.push(spoofed.body.id);
    assert.equal(spoofed.body.questionId, null);
    assert.equal(spoofed.body.questionVersionId, null);
  });

  it("rejects missing or invalid CSRF and accepts a valid token", async () => {
    const cookies = new Cookies();
    await request("/auth/me", {}, complete, cookies);
    const body = JSON.stringify({ kind: "general", message: "csrf" });
    assert.equal((await request("/me/feedback", { method: "POST", headers: { origin: "http://localhost:5173" }, body }, complete, cookies)).status, 403);
    assert.equal((await request("/me/feedback", { method: "POST", headers: { origin: "http://localhost:5173", "x-csrf-token": "wrong" }, body }, complete, cookies)).status, 403);
    assert.equal((await mutation("/me/feedback", { kind: "general", message: "csrf ok" }, complete, cookies)).status, 201);
  });

  it("lets reviewers moderate with stale protection and safe audit access", async () => {
    const created = await mutation("/me/feedback", { kind: "technical", message: "technical" }, complete, new Cookies());
    const id = created.body.id;
    feedbackIds.push(id);
    assert.equal((await request("/admin/beta/feedback", {}, reviewer)).status, 200);
    assert.equal((await request("/admin/beta/feedback", {}, complete)).status, 403);
    const first = await mutation(`/admin/beta/feedback/${id}`, {
      status: "resolved", expectedStatus: "open", resolutionNote: "Fixed",
    }, reviewer, new Cookies(), "PATCH");
    assert.equal(first.status, 200);
    assert.ok(first.body.resolvedAt);
    assert.equal((await mutation(`/admin/beta/feedback/${id}`, {
      status: "dismissed", expectedStatus: "open",
    }, reviewer, new Cookies(), "PATCH")).status, 409);
    assert.equal((await request("/admin/beta/audit", {}, reviewer)).status, 403);
    const audit = await request("/admin/beta/audit", {}, admin);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.items.some((item: any) => item.action === "feedback_moderated"));
  });

  it("returns seven aggregate UTC rows without feedback identities", async () => {
    const result = await request("/admin/beta/summary", {}, reviewer);
    assert.equal(result.status, 200);
    assert.equal(result.body.series.length, 7);
    assert.ok(result.body.series.every((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)));
    assert.equal("email" in result.body, false);
    assert.equal("items" in result.body, false);
  });
});