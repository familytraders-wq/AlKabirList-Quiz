ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "management_id" uuid;
--> statement-breakpoint
UPDATE "users"
SET "management_id" = gen_random_uuid()
WHERE "management_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "management_id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "management_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_management_id_unique"
  ON "users" ("management_id");