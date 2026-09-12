-- Harden attempt idempotency without changing existing production rows.
UPDATE "quiz_attempts"
SET "idempotency_key" = gen_random_uuid()::text
WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "quiz_attempts"
  ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "quiz_attempts_owner_idempotency_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_attempts_user_quiz_idempotency_unique"
  ON "quiz_attempts" ("user_id", "quiz_id", "idempotency_key")
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_attempts_guest_quiz_idempotency_unique"
  ON "quiz_attempts" ("anonymous_session_id", "quiz_id", "idempotency_key")
  WHERE "anonymous_session_id" IS NOT NULL;