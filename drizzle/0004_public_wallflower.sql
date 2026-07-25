ALTER TABLE "participation_certificates" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participation_certificates" ADD COLUMN "data" jsonb;