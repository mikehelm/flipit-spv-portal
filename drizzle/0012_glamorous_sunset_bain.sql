CREATE TYPE "public"."access_request_status" AS ENUM('PENDING', 'VERIFIED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"status" "access_request_status" DEFAULT 'PENDING' NOT NULL,
	"source_hash" text NOT NULL,
	"last_submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_requests_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_status_created_idx" ON "access_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "access_requests_source_created_idx" ON "access_requests" USING btree ("source_hash","created_at");