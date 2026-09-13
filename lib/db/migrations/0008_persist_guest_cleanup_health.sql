CREATE TABLE IF NOT EXISTS "anonymous_session_cleanup_health" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "last_attempt_at" timestamptz,
  "last_success_at" timestamptz,
  "last_failure_at" timestamptz,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "sessions_scanned" integer DEFAULT 0 NOT NULL,
  "attempts_deleted" integer DEFAULT 0 NOT NULL,
  "sessions_deleted" integer DEFAULT 0 NOT NULL,
  "expired_sessions_remaining" integer DEFAULT 0 NOT NULL,
  "abandoned_attempts_remaining" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "anonymous_session_cleanup_health_status_check"
    CHECK ("status" IN ('healthy', 'backlog', 'failed'))
);