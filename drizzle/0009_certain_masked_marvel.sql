ALTER TABLE "email_change_requests" ADD COLUMN "previous_email" text;--> statement-breakpoint
ALTER TABLE "email_change_requests" ADD COLUMN "revoked_at" timestamp with time zone;