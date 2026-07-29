CREATE TABLE "access_request_attempts" (
	"source_hash" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
