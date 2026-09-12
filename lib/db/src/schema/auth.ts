import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["reviewer", "admin"]);

export const users = pgTable(
  "users",
  {
    // Clerk user subjects are opaque text identifiers, not UUIDs.
    id: text("id").primaryKey(),
    managementId: uuid("management_id").defaultRandom().notNull(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    country: text("country"),
    city: text("city"),
    state: text("state"),
    announcementConsent: boolean("announcement_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentVersion: text("consent_version"),
    profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
  },
  (table) => [index("users_clerk_user_id_idx").on(table.clerkUserId)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    grantedByUserId: text("granted_by_user_id"),
  },
  (table) => [
    unique("user_roles_user_role_unique").on(table.userId, table.role),
    index("user_roles_user_id_idx").on(table.userId),
    foreignKey({
      columns: [table.grantedByUserId],
      foreignColumns: [users.id],
      name: "user_roles_granted_by_user_id_fk",
    }),
  ],
);

export const anonymousSessions = pgTable(
  "anonymous_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("anonymous_sessions_expires_at_idx").on(table.expiresAt),
    index("anonymous_sessions_active_idx").on(table.revokedAt, table.expiresAt),
  ],
);

// The quiz task owns the remaining attempt columns. These ownership columns
// are kept here so every attempt route can enforce the identity invariant.
export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    anonymousSessionId: uuid("anonymous_session_id").references(
      () => anonymousSessions.id,
      { onDelete: "set null" },
    ),
    status: text("status").default("in_progress").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "quiz_attempts_exactly_one_owner",
      sql`(("user_id" IS NOT NULL)::integer + ("anonymous_session_id" IS NOT NULL)::integer) = 1`,
    ),
    index("quiz_attempts_user_id_idx").on(table.userId),
    index("quiz_attempts_anonymous_session_id_idx").on(
      table.anonymousSessionId,
    ),
    index("quiz_attempts_incomplete_owner_idx").on(
      table.status,
      table.userId,
      table.anonymousSessionId,
    ),
  ],
);

export const guestProgressLinks = pgTable(
  "guest_progress_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    anonymousSessionId: uuid("anonymous_session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "restrict" }),
    linkedAttemptCount: integer("linked_attempt_count").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("guest_progress_links_user_id_idx").on(table.userId),
    index("guest_progress_links_anonymous_session_id_idx").on(
      table.anonymousSessionId,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
export type AnonymousSession = typeof anonymousSessions.$inferSelect;