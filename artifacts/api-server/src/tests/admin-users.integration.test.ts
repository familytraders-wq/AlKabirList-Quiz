import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  operatorAuditEvents,
  permissionTemplates,
  userPermissionOverrides,
  userPermissionTemplates,
  userRoles,
  users,
} from "@workspace/db/schema";
import { createApp } from "../app";
import { resolveUser } from "../lib/auth";
import { resolvePermissions } from "../lib/permissions";
import { bootstrapAdmin } from "../scripts/bootstrap-admin";

type Identity = { userId: string; role: "member" | "reviewer" | "admin"; isSuperAdmin?: boolean; permissions?: string[] };
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

const admin: Identity = { userId: randomUUID(), role: "admin", isSuperAdmin: true };
const secondAdmin: Identity = { userId: randomUUID(), role: "admin" };
const middlewareOnlyAdmin: Identity = { userId: randomUUID(), role: "admin" };
const legacyClerkId = "user_legacy-access-19";
const reviewer: Identity = { userId: randomUUID(), role: "reviewer" };
const member: Identity = { userId: randomUUID(), role: "member" };
const bootstrapClerkId = `user_bootstrap_${randomUUID()}`;
const testMarker = "admin-users-integration-fixture";
const identities = new Map([admin, secondAdmin, middlewareOnlyAdmin, reviewer, member].map((identity) => [identity.userId, identity]));
const extraUsers = [randomUUID()];
const allUserIds = [admin.userId, secondAdmin.userId, middlewareOnlyAdmin.userId, reviewer.userId, member.userId, legacyClerkId, bootstrapClerkId, ...extraUsers];
let server: Server;
let baseUrl: string;
let managementIds = new Map<string, string>();
const managementIdFor = (internalId: string) => managementIds.get(internalId) ?? internalId;

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

async function accessMutation(path: string, identity: Identity, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, jar = new CookieJar()) {
  await request("/auth/me", identity, {}, jar);
  return request(path, identity, {
    method,
    headers: { origin: "http://localhost:3000", "x-csrf-token": jar.get("alkabir_csrf") ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, jar);
}

before(async () => {
  const staleFixtures = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.firstName, testMarker));
  const staleUserIds = staleFixtures.map((fixture) => fixture.id);
  if (staleUserIds.length > 0) {
    await db.delete(operatorAuditEvents).where(inArray(operatorAuditEvents.actorId, staleUserIds));
    await db.delete(userPermissionOverrides).where(inArray(userPermissionOverrides.userId, staleUserIds));
    await db.delete(userPermissionTemplates).where(inArray(userPermissionTemplates.userId, staleUserIds));
    await db.delete(permissionTemplates).where(inArray(permissionTemplates.createdByUserId, staleUserIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, staleUserIds));
    await db.delete(users).where(inArray(users.id, staleUserIds));
  }
  await db.insert(users).values([
    ...allUserIds.filter((id) => id !== bootstrapClerkId).map((id) => ({
      id,
      role: "member" as const,
      isSuperAdmin: id === admin.userId,
      firstName: testMarker,
    })),
    {
      id: bootstrapClerkId,
      clerkUserId: bootstrapClerkId,
      role: "member" as const,
      firstName: testMarker,
    },
  ]);
  await db.insert(userRoles).values([
    { userId: admin.userId, role: "admin" },
    { userId: secondAdmin.userId, role: "admin" },
    { userId: legacyClerkId, role: "reviewer" },
  ]);
  const managementRows = await db.select({ id: users.id, managementId: users.managementId }).from(users).where(inArray(users.id, allUserIds));
  managementIds = new Map(managementRows.map((row) => [row.id, row.managementId]));
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
  await db.delete(operatorAuditEvents).where(inArray(operatorAuditEvents.actorId, allUserIds));
  await db.delete(userPermissionOverrides).where(inArray(userPermissionOverrides.userId, allUserIds));
  await db.delete(userPermissionTemplates).where(inArray(userPermissionTemplates.userId, allUserIds));
  await db.delete(permissionTemplates).where(eq(permissionTemplates.createdByUserId, admin.userId));
  await db.delete(userRoles).where(inArray(userRoles.userId, allUserIds));
  await db.delete(users).where(inArray(users.id, allUserIds));
  await pool.end();
});

describe("admin user access management", () => {
  it("keeps the protected bootstrap account idempotent and rejects a second account", async () => {
    await db.update(users).set({ clerkUserId: admin.userId }).where(eq(users.id, admin.userId));
    assert.equal(await bootstrapAdmin(admin.userId), "already_granted");
    await assert.rejects(
      () => bootstrapAdmin(bootstrapClerkId),
      /different protected Super Admin/,
    );
    await assert.rejects(
      () => bootstrapAdmin(`user_missing_${randomUUID()}`),
      /No signed-in user matches/,
    );
    await db.update(users).set({ clerkUserId: null }).where(eq(users.id, admin.userId));
  });
  it("forbids reviewers and allows admins to list users", async () => {
    assert.equal((await request("/admin/users", reviewer)).status, 403);
    assert.equal((await request("/admin/users", secondAdmin)).status, 403);
    const result = await request("/admin/users", admin);
    assert.equal(result.status, 200);
    assert.ok(result.body.items.some((item: { id: string }) => item.id === managementIdFor(admin.userId)));
    assert.equal(result.body.items.some((item: { id: string }) => item.id === legacyClerkId), false);
    assert.equal(Object.hasOwn(result.body.items[0], "clerkUserId"), false);
  });

  it("allows only the protected Super Admin to grant and revoke reviewer access", async () => {
    const grant = await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, admin, "POST", "reviewer");
    assert.equal(grant.status, 200);
    const repeatGrant = await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, admin, "POST", "reviewer");
    assert.equal(repeatGrant.status, 200);
    assert.deepEqual(repeatGrant.body.roles.filter((role: string) => role === "reviewer"), ["reviewer"]);
    assert.equal((await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, admin, "DELETE", "reviewer")).status, 200);
    assert.equal((await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, admin, "DELETE", "reviewer")).status, 200);
  });

  it("rejects ordinary admin role and permission management", async () => {
    assert.equal((await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, secondAdmin, "POST", "reviewer")).status, 403);
    const response = await request("/admin/permission-templates", secondAdmin);
    assert.equal(response.status, 403);
    assert.equal((await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-overrides`, secondAdmin, "PUT", {
      permission: "content.view", effect: "allow",
    })).status, 403);
  });

  it("supports template CRUD, assignment, and override precedence", async () => {
    const created = await accessMutation("/admin/permission-templates", admin, "POST", {
      name: `Restricted ${randomUUID()}`,
      description: "Content-only",
      permissions: ["content.view"],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const templateId = created.body.id as string;
    const listed = await request("/admin/permission-templates", admin);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.some((item: { id: string }) => item.id === templateId));

    const updated = await accessMutation(`/admin/permission-templates/${templateId}`, admin, "PATCH", {
      name: created.body.name,
      description: "Restricted content",
      permissions: ["content.view"],
    });
    assert.equal(updated.status, 200);
    const assigned = await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-template`, admin, "PUT", { templateId });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.deepEqual(await resolvePermissions(member.userId, ["admin"]), ["content.view"]);

    const allowed = await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-overrides`, admin, "PUT", {
      permission: "beta.view", effect: "allow",
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await resolvePermissions(member.userId, ["admin"]), ["content.view", "beta.view"]);
    const denied = await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-overrides`, admin, "PUT", {
      permission: "content.view", effect: "deny",
    });
    assert.equal(denied.status, 200);
    assert.deepEqual(await resolvePermissions(member.userId, ["admin"]), ["beta.view"]);

    assert.equal((await accessMutation(`/admin/users/${managementIdFor(admin.userId)}/permission-template`, admin, "PUT", { templateId })).status, 409);
    assert.equal((await accessMutation(`/admin/users/${managementIdFor(admin.userId)}/permission-overrides`, admin, "PUT", {
      permission: "content.view", effect: "deny",
    })).status, 409);
    assert.equal((await accessMutation(`/admin/permission-templates/${templateId}`, secondAdmin, "DELETE")).status, 403);
    assert.equal((await accessMutation(`/admin/permission-templates/${templateId}`, admin, "DELETE")).status, 409);

    assert.equal((await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-template`, admin, "DELETE")).status, 200);
    assert.equal((await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-overrides/content.view`, admin, "DELETE")).status, 200);
    assert.equal((await accessMutation(`/admin/users/${managementIdFor(member.userId)}/permission-overrides/beta.view`, admin, "DELETE")).status, 200);
    assert.equal((await accessMutation(`/admin/permission-templates/${templateId}`, admin, "DELETE")).status, 204);
  });

  it("rejects invalid roles and self admin revocation", async () => {
    const invalid = await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, admin, "POST", "member");
    assert.equal(invalid.status, 400);
    const self = await mutation(`/admin/users/${managementIdFor(admin.userId)}/roles`, admin, "DELETE", "admin");
    assert.equal(self.status, 409);
    assert.equal(self.body.code, "PROTECTED_SUPER_ADMIN");
  });

  it("re-checks the actor's database role inside the mutation transaction", async () => {
    const stale = await mutation(`/admin/users/${managementIdFor(member.userId)}/roles`, middlewareOnlyAdmin, "POST", "reviewer");
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code, "FORBIDDEN");
    const malformed = await mutation("/admin/users/%20/roles", admin, "POST", "reviewer");
    assert.equal(malformed.status, 400);
  });

  it("keeps legacy Clerk subjects opaque in management responses and mutations", async () => {
    const claimed = await resolveUser(legacyClerkId);
    assert.equal(claimed.id, legacyClerkId);
    assert.deepEqual(claimed.roles, ["reviewer"]);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, legacyClerkId));
    assert.equal(rows.length, 1);
    const managementId = managementIdFor(legacyClerkId);
    assert.notEqual(managementId, legacyClerkId);
    assert.equal(managementId.length, 36);
    const result = await mutation(`/admin/users/${managementId}/roles`, admin, "POST", "reviewer");
    assert.equal(result.status, 200);
    assert.equal(result.body.id, managementId);
    assert.equal(result.body.id.startsWith("user_"), false);
  });

  it("protects the final administrator and serializes concurrent revocations", async () => {
    const [first, second] = await Promise.all([
      mutation(`/admin/users/${managementIdFor(secondAdmin.userId)}/roles`, admin, "DELETE", "admin"),
      mutation(`/admin/users/${managementIdFor(admin.userId)}/roles`, secondAdmin, "DELETE", "admin"),
    ]);
    // Depending on lock acquisition order, the losing request is either
    // rejected as stale (its actor was demoted) or by last-admin protection.
    assert.equal([first.status, second.status].filter((status) => status === 200).length, 1);
    assert.ok([403, 409].includes([first.status, second.status].find((status) => status !== 200)!));
    const surviving = await request("/admin/users", admin);
    assert.equal(surviving.status, 200);
    assert.ok(surviving.body.items.filter((item: { roles: string[] }) => item.roles.includes("admin")).length >= 1);
  });
});