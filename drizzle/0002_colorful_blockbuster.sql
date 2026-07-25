ALTER TABLE "qa_entries" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qa_entries" ADD COLUMN "notify_failure" text;