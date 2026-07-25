ALTER TABLE "service_config" ADD COLUMN "attribution_on_admin" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_config" ADD COLUMN "attribution_on_portal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_config" ADD COLUMN "attribution_url" text;