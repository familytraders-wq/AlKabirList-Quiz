DO $$ BEGIN
 CREATE TYPE "public"."feedback_kind" AS ENUM('question_accuracy', 'technical', 'accessibility', 'general');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."feedback_status" AS ENUM('open', 'in_review', 'resolved', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitter_id" text NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"question_id" uuid,
	"question_version_id" uuid,
	"message" text NOT NULL,
	"status" "feedback_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_feedback_message_length" CHECK (char_length("member_feedback"."message") between 1 and 5000),
	CONSTRAINT "member_feedback_resolution_note_length" CHECK ("member_feedback"."resolution_note" is null or char_length("member_feedback"."resolution_note") <= 2000)
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_feedback" ADD CONSTRAINT "member_feedback_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_feedback" ADD CONSTRAINT "member_feedback_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_feedback" ADD CONSTRAINT "member_feedback_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_feedback" ADD CONSTRAINT "member_feedback_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_feedback_submitter_idx" ON "member_feedback" USING btree ("submitter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_feedback_status_created_idx" ON "member_feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_audit_action_length" CHECK (char_length("operator_audit_events"."action") between 1 and 100),
	CONSTRAINT "operator_audit_entity_type_length" CHECK (char_length("operator_audit_events"."entity_type") between 1 and 100),
	CONSTRAINT "operator_audit_entity_id_length" CHECK (char_length("operator_audit_events"."entity_id") between 1 and 256)
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_events_created_idx" ON "operator_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_events_actor_idx" ON "operator_audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_events_entity_idx" ON "operator_audit_events" USING btree ("entity_type","entity_id");