import { eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { userRoles, users } from "@workspace/db/schema";

/** Grant admin to one already-provisioned Clerk identity. */
export async function bootstrapAdmin(
  clerkUserId: string,
  database: typeof db = db,
): Promise<"granted" | "already_granted"> {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  if (rows.length === 0) throw new Error("No signed-in user matches the supplied identity");
  if (rows.length !== 1) throw new Error("Identity lookup was ambiguous");
  const [inserted] = await database
    .insert(userRoles)
    .values({ userId: rows[0].id, role: "admin", grantedByUserId: null })
    .onConflictDoNothing({ target: [userRoles.userId, userRoles.role] })
    .returning({ id: userRoles.id });
  return inserted ? "granted" : "already_granted";
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