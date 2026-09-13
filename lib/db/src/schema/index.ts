import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const questionStatus = pgEnum("question_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "archived",
]);
export const questionType = pgEnum("question_type", [
  "multiple_choice",
  "true_false",
]);
export const reviewDecision = pgEnum("review_decision", [
  "submit",
  "approve",
  "reject",
  "archive",
]);
export const appRole = pgEnum("app_role", ["member", "reviewer", "admin"]);
export const feedbackKind = pgEnum("feedback_kind", [
  "question_accuracy",
  "technical",
  "accessibility",
  "general",
]);
export const feedbackStatus = pgEnum("feedback_status", [
  "open",
  "in_review",
  "resolved",
  "dismissed",
]);

export const userRoleEnum = pgEnum("user_role", ["reviewer", "admin"]);
export const permissionOverrideEffect = pgEnum("permission_override_effect", ["allow", "deny"]);
export const users = pgTable(
  "users",
  {
    // Keep the original text identity type while generating opaque internal IDs.
    id: text("id").default(sql`gen_random_uuid()::text`).primaryKey(),
    // Stable opaque identifier for operator-facing access management. This
    // must never be derived from Clerk's subject or the legacy internal id.
    managementId: uuid("management_id").defaultRandom().notNull(),
    clerkUserId: text("clerk_user_id").unique(),
    role: appRole("role").notNull().default("member"),
    // Exactly one account is marked by bootstrap-admin. Application code must
    // treat this flag as protected and never expose a mutation for it.
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_management_id_unique").on(table.managementId),
    index("users_clerk_user_id_idx").on(table.clerkUserId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
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

/** Reusable, named permission sets maintained by the protected super admin. */
export const permissionTemplates = pgTable(
  "permission_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("permission_templates_name_unique").on(table.name)],
);

export const userPermissionTemplates = pgTable(
  "user_permission_templates",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull().references(() => permissionTemplates.id, { onDelete: "restrict" }),
    assignedByUserId: text("assigned_by_user_id").notNull().references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    effect: permissionOverrideEffect("effect").notNull(),
    grantedByUserId: text("granted_by_user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("user_permission_overrides_user_permission_unique").on(table.userId, table.permission),
    index("user_permission_overrides_user_idx").on(table.userId),
  ],
);
export const taxonomies = pgTable(
  "taxonomies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("taxonomies_kind_slug_unique").on(table.kind, table.slug),
    uniqueIndex("taxonomies_kind_sort_order_unique").on(table.kind, table.sortOrder),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id").references(() => taxonomies.id),
    difficultyId: uuid("difficulty_id").references(() => taxonomies.id),
    status: questionStatus("status").notNull().default("draft"),
    currentVersionId: uuid("current_version_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("questions_public_status_idx").on(table.status)],
);

export const questionAudiences = pgTable(
  "question_audiences",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    audienceId: uuid("audience_id")
      .notNull()
      .references(() => taxonomies.id),
  },
  (table) => [primaryKey({ columns: [table.questionId, table.audienceId] })],
);

export const questionVersions = pgTable(
  "question_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    explanation: text("explanation").notNull(),
    type: questionType("type").notNull().default("multiple_choice"),
    points: integer("points").notNull().default(10),
    sourceMetadata: jsonb("source_metadata")
      .$type<{ title: string; url?: string }[]>()
      .notNull()
      .default([]),
    generationMetadata: jsonb("generation_metadata").$type<{
      provider?: string;
      model?: string;
      promptVersion?: string;
      runId?: string;
    }>(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("question_versions_question_version_unique").on(
      table.questionId,
      table.version,
    ),
    index("question_versions_question_idx").on(table.questionId),
  ],
);

export const questionChoices = pgTable(
  "question_choices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => questionVersions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
  },
  (table) => [
    uniqueIndex("question_choices_version_position_unique").on(
      table.versionId,
      table.position,
    ),
    index("question_choices_version_idx").on(table.versionId),
  ],
);

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    audienceId: uuid("audience_id").references(() => taxonomies.id),
    scheduledDate: date("scheduled_date"),
    timezone: text("timezone").notNull().default("UTC"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quizzes_slug_unique").on(table.slug),
    uniqueIndex("quizzes_daily_audience_unique").on(
      table.scheduledDate,
      table.audienceId,
    ),
  ],
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => questionVersions.id),
    position: integer("position").notNull(),
    points: integer("points").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.quizId, table.versionId] }),
    uniqueIndex("quiz_questions_quiz_position_unique").on(
      table.quizId,
      table.position,
    ),
  ],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    anonymousSessionId: uuid("anonymous_session_id").references(
      () => anonymousSessions.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("in_progress"),
    idempotencyKey: text("idempotency_key").notNull(),
    score: integer("score"),
    maxScore: integer("max_score"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quiz_attempts_user_quiz_idempotency_unique")
      .on(table.userId, table.quizId, table.idempotencyKey)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("quiz_attempts_guest_quiz_idempotency_unique")
      .on(table.anonymousSessionId, table.quizId, table.idempotencyKey)
      .where(sql`${table.anonymousSessionId} is not null`),
    index("quiz_attempts_owner_idx").on(
      table.userId,
      table.anonymousSessionId,
    ),
    check(
      "quiz_attempts_exactly_one_owner",
      sql`(("user_id" IS NOT NULL)::integer + ("anonymous_session_id" IS NOT NULL)::integer) = 1`,
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
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    anonymousSessionId: uuid("anonymous_session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "restrict" }),
    linkedAttemptCount: integer("linked_attempt_count").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guest_progress_links_user_id_idx").on(table.userId),
    index("guest_progress_links_anonymous_session_id_idx").on(table.anonymousSessionId),
  ],
);
export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => questionVersions.id),
    choiceId: uuid("choice_id").references(() => questionChoices.id),
    isCorrect: boolean("is_correct").notNull(),
    awardedPoints: integer("awarded_points").notNull().default(0),
    responseTimeMs: integer("response_time_ms"),
    idempotencyKey: text("idempotency_key").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attempt_answers_attempt_version_unique").on(
      table.attemptId,
      table.versionId,
    ),
    uniqueIndex("attempt_answers_idempotency_unique").on(
      table.attemptId,
      table.idempotencyKey,
    ),
  ],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => questionVersions.id),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.id),
    fromStatus: questionStatus("from_status"),
    toStatus: questionStatus("to_status").notNull(),
    decision: reviewDecision("decision").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("review_events_status_idx").on(table.toStatus)],
);

export const generationRuns = pgTable("generation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestedBy: text("requested_by")
    .notNull()
    .references(() => users.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  outputCount: integer("output_count").notNull().default(0),
  validationSummary: jsonb("validation_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberFeedback = pgTable(
  "member_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submitterId: text("submitter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: feedbackKind("kind").notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    questionVersionId: uuid("question_version_id").references(() => questionVersions.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    status: feedbackStatus("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedById: text("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("member_feedback_message_length", sql`char_length(${table.message}) between 1 and 5000`),
    check(
      "member_feedback_resolution_note_length",
      sql`${table.resolutionNote} is null or char_length(${table.resolutionNote}) <= 2000`,
    ),
    index("member_feedback_submitter_idx").on(table.submitterId),
    index("member_feedback_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const operatorAuditEvents = pgTable(
  "operator_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("operator_audit_action_length", sql`char_length(${table.action}) between 1 and 100`),
    check("operator_audit_entity_type_length", sql`char_length(${table.entityType}) between 1 and 100`),
    check("operator_audit_entity_id_length", sql`char_length(${table.entityId}) between 1 and 256`),
    index("operator_audit_events_created_idx").on(table.createdAt),
    index("operator_audit_events_actor_idx").on(table.actorId),
    index("operator_audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const rewardLedger = pgTable(
  "reward_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempts.id),
    eventKey: text("event_key").notNull(),
    points: integer("points").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reward_ledger_event_key_unique").on(table.eventKey),
    uniqueIndex("reward_ledger_attempt_unique").on(table.attemptId),
  ],
);

/**
 * Daily dates are PostgreSQL date-only values. They intentionally do not use
 * a timestamp or a server-local timezone: challenge selection, completion
 * credit, and rewards all key off the UTC calendar date.
 */
export const dailyAttempts = pgTable(
  "daily_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    challengeId: text("challenge_id").notNull(),
    challengeDate: date("challenge_date").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    ownerType: text("owner_type").notNull(),
    memberId: text("member_id"),
    guestOwnerHash: text("guest_owner_hash"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("daily_attempts_member_idx").on(table.memberId),
    index("daily_attempts_guest_owner_idx").on(table.guestOwnerHash),
    index("daily_attempts_challenge_date_idx").on(table.challengeDate),
  ],
);

export const dailyCompletions = pgTable(
  "daily_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull(),
    memberId: text("member_id").notNull(),
    challengeDate: date("challenge_date").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
    streak: integer("streak").notNull(),
  },
  (table) => [
    uniqueIndex("daily_completions_attempt_unique").on(table.attemptId),
    uniqueIndex("daily_completions_member_date_unique").on(
      table.memberId,
      table.challengeDate,
    ),
    index("daily_completions_member_idx").on(table.memberId),
  ],
);

export const dailyRewards = pgTable(
  "daily_rewards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: text("member_id").notNull(),
    challengeDate: date("challenge_date").notNull(),
    points: integer("points").notNull(),
  },
  (table) => [
    uniqueIndex("daily_rewards_member_date_unique").on(
      table.memberId,
      table.challengeDate,
    ),
  ],
);

export const insertTaxonomySchema = createInsertSchema(taxonomies);
export const insertQuestionSchema = createInsertSchema(questions);
export const insertQuestionVersionSchema = createInsertSchema(questionVersions);
export const insertQuestionChoiceSchema = createInsertSchema(questionChoices);
export const insertQuizSchema = createInsertSchema(quizzes);
export const insertQuizAttemptSchema = createInsertSchema(quizAttempts);
export const insertAttemptAnswerSchema = createInsertSchema(attemptAnswers);
export const insertReviewEventSchema = createInsertSchema(reviewEvents);
export const insertGenerationRunSchema = createInsertSchema(generationRuns);
export const insertRewardLedgerSchema = createInsertSchema(rewardLedger);
export const insertMemberFeedbackSchema = createInsertSchema(memberFeedback);
export const insertOperatorAuditEventSchema = createInsertSchema(operatorAuditEvents);

export const questionRelations = relations(questions, ({ one, many }) => ({
  category: one(taxonomies, {
    fields: [questions.categoryId],
    references: [taxonomies.id],
  }),
  versions: many(questionVersions),
  audiences: many(questionAudiences),
  reviews: many(reviewEvents),
}));
export const questionVersionRelations = relations(
  questionVersions,
  ({ one, many }) => ({
    question: one(questions, {
      fields: [questionVersions.questionId],
      references: [questions.id],
    }),
    choices: many(questionChoices),
  }),
);
export const quizRelations = relations(quizzes, ({ many }) => ({
  questions: many(quizQuestions),
  attempts: many(quizAttempts),
}));
export const attemptRelations = relations(quizAttempts, ({ one, many }) => ({
  quiz: one(quizzes, {
    fields: [quizAttempts.quizId],
    references: [quizzes.id],
  }),
  answers: many(attemptAnswers),
}));

export type Taxonomy = typeof taxonomies.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionVersion = typeof questionVersions.$inferSelect;
export type QuestionChoice = typeof questionChoices.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;

export type User = typeof users.$inferSelect;
export type MemberFeedback = typeof memberFeedback.$inferSelect;
export type OperatorAuditEvent = typeof operatorAuditEvents.$inferSelect;

export type UserRole = typeof userRoles.$inferSelect;
export type PermissionTemplate = typeof permissionTemplates.$inferSelect;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;

export type AnonymousSession = typeof anonymousSessions.$inferSelect;

export const anonymousSessions = pgTable(
  "anonymous_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("anonymous_sessions_expires_at_idx").on(table.expiresAt),
    index("anonymous_sessions_active_idx").on(table.revokedAt, table.expiresAt),
  ],
);

/**
 * Singleton aggregate state for guest-session retention. This deliberately
 * contains no session identifiers or other guest data so it can be recovered
 * safely after an API restart.
 */
export const anonymousSessionCleanupHealth = pgTable(
  "anonymous_session_cleanup_health",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    sessionsScanned: integer("sessions_scanned").notNull().default(0),
    attemptsDeleted: integer("attempts_deleted").notNull().default(0),
    sessionsDeleted: integer("sessions_deleted").notNull().default(0),
    expiredSessionsRemaining: integer("expired_sessions_remaining")
      .notNull()
      .default(0),
    abandonedAttemptsRemaining: integer("abandoned_attempts_remaining")
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "anonymous_session_cleanup_health_status_check",
      sql`${table.status} in ('healthy', 'backlog', 'failed')`,
    ),
  ],
);
