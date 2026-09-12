import { eq, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { userRoles, users } from "@workspace/db/schema";

/** Grant admin to one already-provisioned Clerk identity. */
export async function bootstrapAdmin(
  clerkUserId: string,
  database: typeof db = db,
): Promise<"granted" | "already_granted"> {
  return database.transaction(async (tx) => {
    // Serialize bootstrap attempts and make the database-backed uniqueness
    // check authoritative even when two deploy processes start together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('alkabir-super-admin-bootstrap'))`);
    const rows = await tx
      .select({ id: users.id, isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId));
    if (rows.length === 0) throw new Error("No signed-in user matches the supplied identity");
    if (rows.length !== 1) throw new Error("Identity lookup was ambiguous");
    const target = rows[0];
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true));
    if (existing && existing.id !== target.id) {
      throw new Error("A different protected Super Admin already exists; bootstrap cannot be reassigned");
    }
    if (!target.isSuperAdmin) {
      await tx.update(users).set({ isSuperAdmin: true, updatedAt: new Date() }).where(eq(users.id, target.id));
    }
    await tx
      .insert(userRoles)
      .values({ userId: target.id, role: "admin", grantedByUserId: null })
      .onConflictDoNothing({ target: [userRoles.userId, userRoles.role] });
    return target.isSuperAdmin ? "already_granted" : "granted";
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^\S+$/.test(args[0] ?? "")) {
    process.stderr.write("Usage: pnpm --filter @workspace/api-server bootstrap-admin <exact-clerk-user-id>\n");
    process.exitCode = 2;
    return;
  }
  try {
    await bootstrapAdmin(args[0]);
    process.stdout.write("Administrator role bootstrap completed.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Administrator bootstrap failed"}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("bootstrap-admin.ts")) void main();