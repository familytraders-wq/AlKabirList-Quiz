-- Reconcile the Clerk/guest runtime with installations created from 0000.
--
-- This migration is deliberately forward-only and idempotent.  In particular,
-- users.id remains text: Clerk subjects are opaque strings and must not be
-- converted to UUIDs.  Existing quiz rows are never rewritten or removed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE "user_role" AS ENUM ('reviewer', 'admin');
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "clerk_user_id" text,
  ADD COLUMN IF NOT EXISTS "role" "app_role" DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();

-- Keep this nullable for legacy rows; the application fills it on Clerk login.
ALTER TABLE "users"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "updated_at" SET DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_user_id_unique"
  ON "users" ("clerk_user_id");
CREATE INDEX IF NOT EXISTS "users_clerk_user_id_idx"
  ON "users" ("clerk_user_id");

-- Legacy Clerk subjects were stored directly as users.id. Backfill only the
-- unmistakable Clerk shape, never overwrite an existing mapping, and preserve
-- every text id and foreign-key reference.
UPDATE "users" AS legacy
SET "clerk_user_id" = legacy."id"
WHERE legacy."clerk_user_id" IS NULL
  AND legacy."id" LIKE 'user\_%' ESCAPE '\'
  AND NOT EXISTS (
    SELECT 1
    FROM "users" AS mapped
    WHERE mapped."clerk_user_id" = legacy."id"
  );

CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "role" "user_role" NOT NULL,
  "granted_at" timestamptz DEFAULT now() NOT NULL,
  "granted_by_user_id" text
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_roles'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE "user_roles"
      DROP CONSTRAINT IF EXISTS "user_roles_user_id_fk",
      DROP CONSTRAINT IF EXISTS "user_roles_granted_by_user_id_fk";
    ALTER TABLE "user_roles"
      ALTER COLUMN "user_id" TYPE text USING "user_id"::text,
      ALTER COLUMN "granted_by_user_id" TYPE text USING "granted_by_user_id"::text;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_user_role_unique"
  ON "user_roles" ("user_id", "role");
CREATE INDEX IF NOT EXISTS "user_roles_user_id_idx"
  ON "user_roles" ("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_fk'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id")
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_granted_by_user_id_fk'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_granted_by_user_id_fk"
      FOREIGN KEY ("granted_by_user_id") REFERENCES "users" ("id")
      NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "anonymous_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "anonymous_sessions_token_hash_unique"
  ON "anonymous_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "anonymous_sessions_expires_at_idx"
  ON "anonymous_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "anonymous_sessions_active_idx"
  ON "anonymous_sessions" ("revoked_at", "expires_at");

-- 0000 represented this value as text. UUID values are retained exactly while
-- adopting the UUID type used by the current Drizzle schema.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'quiz_attempts'
     AND column_name = 'anonymous_session_id';
  IF current_type = 'text' THEN
    ALTER TABLE "quiz_attempts"
      ALTER COLUMN "anonymous_session_id" TYPE uuid
      USING CASE
        WHEN "anonymous_session_id" IS NULL OR btrim("anonymous_session_id") = '' THEN NULL
        WHEN "anonymous_session_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN "anonymous_session_id"::uuid
        ELSE NULL
      END;
  END IF;
END $$;

ALTER TABLE "quiz_attempts"
  ADD COLUMN IF NOT EXISTS "user_id" text,
  ADD COLUMN IF NOT EXISTS "anonymous_session_id" uuid,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_attempts_user_id_fk'
  ) THEN
    ALTER TABLE "quiz_attempts"
      ADD CONSTRAINT "quiz_attempts_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_attempts_anonymous_session_id_fk'
  ) THEN
    ALTER TABLE "quiz_attempts"
      ADD CONSTRAINT "quiz_attempts_anonymous_session_id_fk"
      FOREIGN KEY ("anonymous_session_id") REFERENCES "anonymous_sessions" ("id")
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_attempts_exactly_one_owner'
  ) THEN
    ALTER TABLE "quiz_attempts"
      ADD CONSTRAINT "quiz_attempts_exactly_one_owner"
      CHECK ((("user_id" IS NOT NULL)::integer +
              ("anonymous_session_id" IS NOT NULL)::integer) = 1) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "quiz_attempts_owner_idempotency_unique"
  ON "quiz_attempts" ("user_id", "anonymous_session_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "quiz_attempts_owner_idx"
  ON "quiz_attempts" ("user_id", "anonymous_session_id");
CREATE INDEX IF NOT EXISTS "quiz_attempts_incomplete_owner_idx"
  ON "quiz_attempts" ("status", "user_id", "anonymous_session_id");

CREATE TABLE IF NOT EXISTS "guest_progress_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "anonymous_session_id" uuid NOT NULL,
  "linked_attempt_count" integer NOT NULL,
  "linked_at" timestamptz DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'guest_progress_links'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE "guest_progress_links"
      DROP CONSTRAINT IF EXISTS "guest_progress_links_user_id_fk",
      DROP CONSTRAINT IF EXISTS "guest_progress_links_anonymous_session_id_fk";
    ALTER TABLE "guest_progress_links"
      ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "guest_progress_links_user_id_idx"
  ON "guest_progress_links" ("user_id");
CREATE INDEX IF NOT EXISTS "guest_progress_links_anonymous_session_id_idx"
  ON "guest_progress_links" ("anonymous_session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guest_progress_links_user_id_fk'
  ) THEN
    ALTER TABLE "guest_progress_links"
      ADD CONSTRAINT "guest_progress_links_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id")
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guest_progress_links_anonymous_session_id_fk'
  ) THEN
    ALTER TABLE "guest_progress_links"
      ADD CONSTRAINT "guest_progress_links_anonymous_session_id_fk"
      FOREIGN KEY ("anonymous_session_id") REFERENCES "anonymous_sessions" ("id")
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;