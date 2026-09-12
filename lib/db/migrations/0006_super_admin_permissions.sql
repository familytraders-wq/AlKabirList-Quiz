ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "users_single_super_admin_unique" ON "users" ("is_super_admin") WHERE "is_super_admin" = true;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "permission_override_effect" AS ENUM ('allow', 'deny');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "permissions" text[] NOT NULL DEFAULT '{}',
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permission_templates_name_unique" ON "permission_templates" ("name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_templates" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "template_id" uuid NOT NULL REFERENCES "permission_templates"("id") ON DELETE RESTRICT,
  "assigned_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "assigned_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "permission" text NOT NULL,
  "effect" "permission_override_effect" NOT NULL,
  "granted_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_permission_overrides_user_permission_unique" UNIQUE ("user_id", "permission")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_permission_overrides_user_idx" ON "user_permission_overrides" ("user_id");