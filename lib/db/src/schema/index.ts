import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  "approve",
  "reject",
  "archive",
]);
export const appRole = pgEnum("app_role", ["member", "reviewer", "admin"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  role: appRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdBy: text("created_by").references(() => users.id),
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
    createdBy: text("created_by").references(() => users.id),
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
    userId: text("user_id").references(() => users.id),
    anonymousSessionId: text("anonymous_session_id"),
    status: text("status").notNull().default("in_progress"),
    idempotencyKey: text("idempotency_key"),
    score: integer("score"),
    maxScore: integer("max_score"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quiz_attempts_owner_idempotency_unique").on(
      table.userId,
      table.anonymousSessionId,
      table.idempotencyKey,
    ),
    index("quiz_attempts_owner_idx").on(
      table.userId,
      table.anonymousSessionId,
    ),
    sql`CHECK ((${table.userId} IS NOT NULL AND ${table.anonymousSessionId} IS NULL) OR (${table.userId} IS NULL AND ${table.anonymousSessionId} IS NOT NULL))`,
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