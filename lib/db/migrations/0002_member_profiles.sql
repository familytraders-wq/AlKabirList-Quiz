-- Add member onboarding profile data without changing legacy text identities.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_name" text,
  ADD COLUMN IF NOT EXISTS "last_name" text,
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "country" text,
  ADD COLUMN IF NOT EXISTS "city" text,
  ADD COLUMN IF NOT EXISTS "state" text,
  ADD COLUMN IF NOT EXISTS "announcement_consent" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consent_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "consent_version" text,
  ADD COLUMN IF NOT EXISTS "profile_completed_at" timestamptz;