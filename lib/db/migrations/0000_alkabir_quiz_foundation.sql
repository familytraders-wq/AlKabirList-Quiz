CREATE TYPE "app_role" AS ENUM ('member', 'reviewer', 'admin');
CREATE TYPE "question_status" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'archived');
CREATE TYPE "question_type" AS ENUM ('multiple_choice', 'true_false');
CREATE TYPE "review_decision" AS ENUM ('approve', 'reject', 'archive');

CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "role" "app_role" DEFAULT 'member' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "taxonomies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "taxonomies_kind_slug_unique" ON "taxonomies" ("kind","slug");
CREATE UNIQUE INDEX "taxonomies_kind_sort_order_unique" ON "taxonomies" ("kind","sort_order");
CREATE TABLE "questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category_id" uuid REFERENCES "taxonomies"("id"),
  "difficulty_id" uuid REFERENCES "taxonomies"("id"),
  "status" "question_status" DEFAULT 'draft' NOT NULL,
  "current_version_id" uuid,
  "created_by" text REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "questions_public_status_idx" ON "questions" ("status");
CREATE TABLE "question_audiences" (
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "audience_id" uuid NOT NULL REFERENCES "taxonomies"("id"),
  PRIMARY KEY ("question_id","audience_id")
);
CREATE TABLE "question_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "prompt" text NOT NULL,
  "explanation" text NOT NULL,
  "type" "question_type" DEFAULT 'multiple_choice' NOT NULL,
  "points" integer DEFAULT 10 NOT NULL,
  "source_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generation_metadata" jsonb,
  "created_by" text REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "question_versions_question_version_unique" ON "question_versions" ("question_id","version");
CREATE INDEX "question_versions_question_idx" ON "question_versions" ("question_id");
ALTER TABLE "questions" ADD CONSTRAINT "questions_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "question_versions"("id");
CREATE TABLE "question_choices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "question_versions"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "position" integer NOT NULL,
  "is_correct" boolean DEFAULT false NOT NULL
);
CREATE UNIQUE INDEX "question_choices_version_position_unique" ON "question_choices" ("version_id","position");
CREATE UNIQUE INDEX "question_choices_one_correct_unique" ON "question_choices" ("version_id") WHERE "is_correct" = true;
CREATE INDEX "question_choices_version_idx" ON "question_choices" ("version_id");
CREATE TABLE "quizzes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "audience_id" uuid REFERENCES "taxonomies"("id"),
  "scheduled_date" date,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "quizzes_slug_unique" ON "quizzes" ("slug");
CREATE UNIQUE INDEX "quizzes_daily_audience_unique" ON "quizzes" ("scheduled_date","audience_id");
CREATE TABLE "quiz_questions" (
  "quiz_id" uuid NOT NULL REFERENCES "quizzes"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "question_versions"("id"),
  "position" integer NOT NULL,
  "points" integer NOT NULL,
  PRIMARY KEY ("quiz_id","version_id")
);
CREATE UNIQUE INDEX "quiz_questions_quiz_position_unique" ON "quiz_questions" ("quiz_id","position");
CREATE TABLE "quiz_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quiz_id" uuid NOT NULL REFERENCES "quizzes"("id"),
  "user_id" text REFERENCES "users"("id"),
  "anonymous_session_id" text,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "idempotency_key" text,
  "score" integer,
  "max_score" integer,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "quiz_attempts_owner_check" CHECK (("user_id" IS NOT NULL AND "anonymous_session_id" IS NULL) OR ("user_id" IS NULL AND "anonymous_session_id" IS NOT NULL)
));
CREATE UNIQUE INDEX "quiz_attempts_owner_idempotency_unique" ON "quiz_attempts" ("user_id","anonymous_session_id","idempotency_key");
CREATE INDEX "quiz_attempts_owner_idx" ON "quiz_attempts" ("user_id","anonymous_session_id");
CREATE TABLE "attempt_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attempt_id" uuid NOT NULL REFERENCES "quiz_attempts"("id") ON DELETE CASCADE,
  "version_id" uuid NOT NULL REFERENCES "question_versions"("id"),
  "choice_id" uuid REFERENCES "question_choices"("id"),
  "is_correct" boolean NOT NULL,
  "awarded_points" integer DEFAULT 0 NOT NULL,
  "response_time_ms" integer,
  "idempotency_key" text NOT NULL,
  "answered_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "attempt_answers_attempt_version_unique" ON "attempt_answers" ("attempt_id","version_id");
CREATE UNIQUE INDEX "attempt_answers_idempotency_unique" ON "attempt_answers" ("attempt_id","idempotency_key");
CREATE TABLE "review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "version_id" uuid REFERENCES "question_versions"("id"),
  "reviewer_id" text NOT NULL REFERENCES "users"("id"),
  "from_status" "question_status",
  "to_status" "question_status" NOT NULL,
  "decision" "review_decision" NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "review_events_status_idx" ON "review_events" ("to_status");
CREATE TABLE "generation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requested_by" text NOT NULL REFERENCES "users"("id"),
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "output_count" integer DEFAULT 0 NOT NULL,
  "validation_summary" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "reward_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "attempt_id" uuid NOT NULL REFERENCES "quiz_attempts"("id"),
  "event_key" text NOT NULL,
  "points" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "reward_ledger_event_key_unique" ON "reward_ledger" ("event_key");
CREATE UNIQUE INDEX "reward_ledger_attempt_unique" ON "reward_ledger" ("attempt_id");