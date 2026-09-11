import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { createApp } from "../app";

type Identity = { userId: string; role: "member" };
const alice: Identity = { userId: randomUUID(), role: "member" };
const bob: Identity = { userId: randomUUID(), role: "member" };
let server: Server;
let baseUrl: string;

class Cookies {
  values = new Map<string, string>();
  add(value: string) {
    const pair = value.split(";")[0]!;
    const index = pair.indexOf("=");
    this.values.set(pair.slice(0, index), pair.slice(index + 1));
  }
  header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function request(path: string, options: RequestInit = {}, identity?: Identity, cookies?: Cookies) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (identity) headers.set("x-test-user-id", identity.userId);
  if (cookies) headers.set("cookie", cookies.header());
  if (options.method && options.method !== "GET") {
    if (cookies && !cookies.values.has("alkabir_csrf")) {
      cookies.values.set("alkabir_csrf", "test-csrf-token");
      headers.set("cookie", cookies.header());
    }
    headers.set("origin", "http://localhost:5173");
    const csrf = cookies?.values.get("alkabir_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(`${baseUrl}/api${path}`, { ...options, headers });
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = responseHeaders.getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  for (const value of setCookies) {
    for (const cookie of value.split(/,(?=[^;,]+=)/)) cookies?.add(cookie);
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const completeProfile = {
  firstName: "Alice",
  lastName: "Member",
  email: "alice@example.com",
  country: "US",
  city: "Chicago",
  state: "IL",
  announcementConsent: true,
};

before(async () => {
  await db.insert(users).values([{ id: alice.userId }, { id: bob.userId }]);
  server = await new Promise<Server>((resolve) => {
    const instance = createApp({
      resolveAuth: (req) => {
        const id = req.header("x-test-user-id");
        return id === alice.userId ? alice : id === bob.userId ? bob : undefined;
      },
    }).listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await db.delete(users).where(eq(users.id, alice.userId));
  await db.delete(users).where(eq(users.id, bob.userId));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

describe("member profile API", () => {
  it("rejects unauthenticated profile access", async () => {
    assert.equal((await request("/me/profile")).status, 401);
  });

  it("reports incomplete auth state, then persists and reloads a complete profile", async () => {
    const initial = await request("/auth/me", {}, alice);
    assert.equal(initial.body.profileComplete, false);
    assert.equal(initial.body.onboardingRequired, true);
    const cookies = new Cookies();
    const saved = await request("/me/profile", { method: "PUT", body: JSON.stringify(completeProfile) }, alice, cookies);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profileComplete, true);
    const reloaded = await request("/me/profile", {}, alice, cookies);
    assert.equal(reloaded.body.email, completeProfile.email);
    const auth = await request("/auth/me", {}, alice, cookies);
    assert.equal(auth.body.profileComplete, true);
    assert.equal(auth.body.onboardingRequired, false);
  });

  it("does not expose or update another member's profile", async () => {
    const response = await request("/me/profile", {}, bob);
    assert.equal(response.status, 200);
    assert.notEqual(response.body.email, completeProfile.email);
  });

  it("enforces names, email, US state, and explicit consent", async () => {
    const cookies = new Cookies();
    const invalid = await request("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ ...completeProfile, firstName: "", email: "not-email", announcementConsent: false }),
    }, bob, cookies);
    assert.equal(invalid.status, 400);
    const noState = await request("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ ...completeProfile, email: "bob@example.com", state: undefined, announcementConsent: true }),
    }, bob, cookies);
    assert.equal(noState.status, 400);
    const nonUsState = await request("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ ...completeProfile, email: "bob@example.com", country: "CA", state: "ON", announcementConsent: true }),
    }, bob, cookies);
    assert.equal(nonUsState.status, 400);
    const saved = await request("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ ...completeProfile, email: "bob@example.com", country: "CA", state: null, announcementConsent: true }),
    }, bob, cookies);
    assert.equal(saved.status, 200);
    const revoke = await request("/me/profile", { method: "PATCH", body: JSON.stringify({ announcementConsent: false }) }, bob, cookies);
    assert.equal(revoke.status, 400);
  });
});