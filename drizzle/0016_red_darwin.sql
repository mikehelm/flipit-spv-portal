CREATE TABLE "usability_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"page_path" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"rapid_click_count" integer DEFAULT 0 NOT NULL,
	"browser_error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usability_events" ADD CONSTRAINT "usability_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usability_events_actor_created_idx" ON "usability_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "usability_events_created_idx" ON "usability_events" USING btree ("created_at");