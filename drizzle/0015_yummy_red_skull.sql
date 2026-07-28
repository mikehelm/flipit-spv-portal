CREATE TYPE "public"."email_review_proposal_status" AS ENUM('SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED', 'PROMOTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "email_review_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by_id" text NOT NULL,
	"section_id" text NOT NULL,
	"section_label" text NOT NULL,
	"before_text" text NOT NULL,
	"proposed_text" text NOT NULL,
	"reason" text NOT NULL,
	"status" "email_review_proposal_status" DEFAULT 'SUBMITTED' NOT NULL,
	"base_template_hash" text NOT NULL,
	"candidate_template_hash" text NOT NULL,
	"candidate_subject" text NOT NULL,
	"candidate_html_source" text NOT NULL,
	"candidate_text_source" text NOT NULL,
	"policy_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_review" text,
	"ai_model" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_id" text,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"promoted_template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_review_proposals" ADD CONSTRAINT "email_review_proposals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_review_proposals" ADD CONSTRAINT "email_review_proposals_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_review_proposals" ADD CONSTRAINT "email_review_proposals_promoted_template_id_email_templates_id_fk" FOREIGN KEY ("promoted_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_review_proposals_status_idx" ON "email_review_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_review_proposals_creator_idx" ON "email_review_proposals" USING btree ("created_by_id","created_at");