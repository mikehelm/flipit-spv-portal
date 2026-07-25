ALTER TABLE "document_packages" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_packages" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_packages" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_supersedes_id_document_packages_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."document_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_packages_supersedes_idx" ON "document_packages" USING btree ("supersedes_id");