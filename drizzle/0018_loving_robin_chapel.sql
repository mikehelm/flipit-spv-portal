DROP INDEX "recipients_round_email_idx";--> statement-breakpoint
ALTER TABLE "offers" ALTER COLUMN "response_deadline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "jurisdiction" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "recipients_round_email_idx" ON "recipients" USING btree ("round_id","email");