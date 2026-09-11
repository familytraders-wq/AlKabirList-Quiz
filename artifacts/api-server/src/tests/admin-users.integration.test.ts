import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { userRoles, users } from "@workspace/db/schema";
import { createApp } from "../app";
import { resolveUser } from "../lib/auth";

type Identity = { userId: string; role: "member" | "reviewer" | "admin" };
type Result = { status: number; body: any; cookies: string[] };

class CookieJar {
  private values = new Map<string, string>();
  set(headers: Headers) {
    const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
    for (const value of values) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  header() { return [...this.values].map(([key, value]) => `${key}=${value}`).join("; "); }
  get(name: string) { return this.values.get(name); }
}

const admin: Identity = { userId: randomUUID(), role: "admin" };
const secondAdmin: Identity = { userId: randomUUID(), role: "admin" };
const middlewareOnlyAdmin: Identity = { userId: randomUUID(), role: "admin" };
const legacyClerkId = "user_legacy-access-19";
const reviewer: Identity = { userId: randomUUID(), role: "reviewer" };
const member: Identity = { userId: randomUUID(), role: "member" };
const identities = new Map([admin, secondAdmin, middlewareOnlyAdmin, reviewer, member].map((identity) => [identity.userId, identity]));
const extraUsers = [randomUUID()];
const allUserIds = [admin.userId, secondAdmin.userId, middlewareOnlyAdmin.userId, reviewer.userId, member.userId, legacyClerkId, ...extraUsers];
let server: Server;
let baseUrl: string;

async function request(path: string, identity?: Identity, init: RequestInit = {}, jar = new CookieJar()): Promise<Result> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (identity) headers.set("x-test-user-id", identity.userId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (jar.header()) headers.set("cookie", jar.header());
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers });
  jar.set(response.headers);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, cookies: jar.header().split("; ") };
}

async function mutation(path: string, identity: Identity, method: "POST" | "DELETE", role: string, jar = new CookieJar()) {
  await request("/auth/me", identity, {}, jar);
  return request(path, identity, {
    method,
    // The test server origin is not a browser origin; use one of the explicit
    // development origins accepted by the production CSRF policy.
    headers: { origin: "http://localhost:3000", "x-csrf-token": jar.get("alkabir_csrf") ?? "" },
    body: JSON.stringify({ role }),
  }, jar);
}

before(async () => {
  await db.insert(users).values(allUserIds.map((id) => ({ id, role: "member" as const })));
  await db.insert(userRoles).values([
    { userId: admin.userId, role: "admin" },
    { userId: secondAdmin.userId, role: "admin" },
    { userId: legacyClerkId, role: "reviewer" },
  ]);
  server = await new Promise<Server>((resolve) => {
    const instance = createApp({
      resolveAuth: (req) => {
        const userId = req.header("x-test-user-id");
        return userId ? identities.get(userId) : undefined;
      },
    }).listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(userRoles).where(inArray(userRoles.userId, allUserIds));
  await db.delete(users).where(inArray(users.id, allUserIds));
  await pool.end();
});

describe("admin user access management", () => {
  it("forbids reviewers and allows admins to list users", async () => {
    assert.equal((await request("/admin/users", reviewer)).status, 403);
    const result = await request("/admin/users", admin);
    assert.equal(result.status, 200);
    assert.ok(result.body.items.some((item: { id: string }) => item.id === admin.userId));
    assert.equal(Object.hasOwn(result.body.items[0], "clerkUserId"), false);
  });

  it("grants and revokes reviewer access idempotently", async () => {
    const grant = await mutation(`/admin/users/${member.userId}/roles`, admin, "POST", "reviewer");
    assert.equal(grant.status, 200);
    const repeatGrant = await mutation(`/admin/users/${member.userId}/roles`, admin, "POST", "reviewer");
    assert.equal(repeatGrant.status, 200);
    assert.deepEqual(repeatGrant.body.roles.filter((role: string) => role === "reviewer"), ["reviewer"]);
    assert.equal((await mutation(`/admin/users/${member.userId}/roles`, admin, "DELETE", "reviewer")).status, 200);
    assert.equal((await mutation(`/admin/users/${member.userId}/roles`, admin, "DELETE", "reviewer")).status, 200);
  });

  it("rejects invalid roles and self admin revocation", async () => {
    const invalid = await mutation(`/admin/users/${member.userId}/roles`, admin, "POST", "member");
    assert.equal(invalid.status, 400);
    const self = await mutation(`/admin/users/${admin.userId}/roles`, admin, "DELETE", "admin");
    assert.equal(self.status, 409);
    assert.equal(self.body.code, "SELF_ADMIN_REVOKE");
  });

  it("re-checks the actor's database role inside the mutation transaction", async () => {
    const stale = await mutation(`/admin/users/${member.userId}/roles`, middlewareOnlyAdmin, "POST", "reviewer");
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code, "FORBIDDEN");
    const malformed = await mutation("/admin/users/%20/roles", admin, "POST", "reviewer");
    assert.equal(malformed.status, 400);
  });

  it("claims a legacy Clerk id without duplicating it and accepts it in admin routes", async () => {
    const claimed = await resolveUser(legacyClerkId);
    assert.equal(claimed.id, legacyClerkId);
    assert.deepEqual(claimed.roles, ["reviewer"]);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, legacyClerkId));
    assert.equal(rows.length, 1);
    const result = await mutation(`/admin/users/${legacyClerkId}/roles`, admin, "POST", "reviewer");
    assert.equal(result.status, 200);
    assert.equal(result.body.id, legacyClerkId);
  });

  it("protects the final administrator and serializes concurrent revocations", async () => {
    const [first, second] = await Promise.all([
      mutation(`/admin/users/${secondAdmin.userId}/roles`, admin, "DELETE", "admin"),
      mutation(`/admin/users/${admin.userId}/roles`, secondAdmin, "DELETE", "admin"),
    ]);
    // Depending on lock acquisition order, the losing request is either
    // rejected as stale (its actor was demoted) or by last-admin protection.
    assert.equal([first.status, second.status].filter((status) => status === 200).length, 1);
    assert.ok([403, 409].includes([first.status, second.status].find((status) => status !== 200)!));
    const surviving = await request("/admin/users", admin);
    assert.equal(surviving.status, 200);
    assert.equal(surviving.body.items.filter((item: { roles: string[] }) => item.roles.includes("admin")).length, 1);
  });
});