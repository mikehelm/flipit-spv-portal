CREATE TYPE "public"."account_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."block_reason" AS ENUM('JURISDICTION_NOT_APPROVED', 'VALIDATION_FAILED', 'UNRESOLVED_TEMPLATE_VARIABLE', 'MANUALLY_HELD');--> statement-breakpoint
CREATE TYPE "public"."closed_account_access" AS ENUM('READ_ONLY', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."contact_method" AS ENUM('PHONE', 'WHATSAPP', 'EMAIL_ONLY');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('DRAFT', 'SENT', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."email_transport" AS ENUM('SMTP', 'GMAIL_API');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('FROM_INVESTOR', 'FROM_OPERATOR');--> statement-breakpoint
CREATE TYPE "public"."offer_stage" AS ENUM('INVITATION_SENT', 'RESPONSE_RECORDED', 'DOCUMENTS_ISSUED', 'COMMITMENT_AGREED', 'ALLOCATION_ACCEPTED', 'PAYMENT_INSTRUCTIONS_ISSUED', 'FUNDS_RECEIVED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."response_choice" AS ENUM('NO_RESPONSE', 'INTERESTED', 'NOT_INTERESTED', 'QUESTION');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'OPERATOR');--> statement-breakpoint
CREATE TYPE "public"."send_outcome" AS ENUM('SUCCEEDED', 'FAILED_TRANSIENT', 'FAILED_PERMANENT', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."service_mode" AS ENUM('ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('INVITATION', 'REMINDER');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('CLAIM', 'SIGN_IN', 'OPERATOR_INVITE');--> statement-breakpoint
CREATE TABLE "account_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"from_status" "account_status",
	"to_status" "account_status" NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"investor_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"import_job_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_summary" text NOT NULL,
	"raw_proposal" text NOT NULL,
	"accepted_by_id" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_account_id" text,
	"actor_label" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "column_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"import_job_id" text NOT NULL,
	"source_column" text NOT NULL,
	"target_field" text NOT NULL,
	"transform" text,
	"was_proposed" boolean DEFAULT false NOT NULL,
	"was_corrected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"spv_percentage" numeric(9, 6) NOT NULL,
	"agreed_at" timestamp with time zone NOT NULL,
	"recorded_by_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitments_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"approver_name" text NOT NULL,
	"approver_role" text NOT NULL,
	"approver_firm" text,
	"approved_at" timestamp with time zone NOT NULL,
	"evidence_reference" text NOT NULL,
	"approved_jurisdictions" text[] NOT NULL,
	"approved_template_hash" text NOT NULL,
	"template_kind" "template_kind" NOT NULL,
	"conditions" text,
	"recorded_by_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"offer_id" text,
	"direction" "message_direction" NOT NULL,
	"body" text NOT NULL,
	"email_message_id" text,
	"in_reply_to" text,
	"sent_at" timestamp with time zone,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"issued_at" timestamp with time zone,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"kind" "template_kind" NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"to_address" text NOT NULL,
	"template_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "template_kind" NOT NULL,
	"subject" text NOT NULL,
	"html_source" text NOT NULL,
	"text_source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hash" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by_id" text NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"row_count" integer,
	"storage_key" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funds_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"value_date" date NOT NULL,
	"reference" text NOT NULL,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_receipts_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"filename" text NOT NULL,
	"source_headers" text[] NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"used_ai" boolean DEFAULT false NOT NULL,
	"confirmed_by_id" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interest_register_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"indicative_amount_usd" numeric(18, 2),
	"operator_order_override" integer,
	"override_reason" text,
	"override_by_id" text,
	"added_by_operator" boolean DEFAULT false NOT NULL,
	CONSTRAINT "interest_register_entries_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "investor_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"status" "account_status" DEFAULT 'INVITED' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "investor_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"choice" "response_choice" NOT NULL,
	"message" text,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"account_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "offer_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"from_stage" "offer_stage",
	"to_stage" "offer_stage" NOT NULL,
	"is_correction" boolean DEFAULT false NOT NULL,
	"reason" text,
	"investor_note" text,
	"internal_note" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"account_id" text NOT NULL,
	"recipient_id" text,
	"proposed_amount_usd" numeric(18, 2) NOT NULL,
	"committed_amount_usd" numeric(18, 2),
	"accepted_amount_usd" numeric(18, 2),
	"received_amount_usd" numeric(18, 2),
	"spv_percentage" numeric(9, 6) NOT NULL,
	"indirect_percentage" numeric(9, 6) NOT NULL,
	"indirect_overridden" boolean DEFAULT false NOT NULL,
	"response_deadline" date NOT NULL,
	"original_deadline" date,
	"stage" "offer_stage" DEFAULT 'INVITATION_SENT' NOT NULL,
	"email_status" "email_status" DEFAULT 'DRAFT' NOT NULL,
	"response_choice" "response_choice" DEFAULT 'NO_RESPONSE' NOT NULL,
	"response_at" timestamp with time zone,
	"response_note" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"block_reason" "block_reason",
	"block_detail" text,
	"jurisdiction_approval_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"accepted_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "operator_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"caption" text,
	"transcript" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participation_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_at" timestamp with time zone,
	"storage_key" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_instructions" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"delivery_note" text,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_instructions_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"offer_id" text,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "portal_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"notify_by_email" boolean DEFAULT true NOT NULL,
	"audience_filter" text,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"asked_by_account_id" text,
	"offer_id" text,
	"question_original" text NOT NULL,
	"question_public" text,
	"answer" text,
	"answered_by_id" text,
	"answered_at" timestamp with time zone,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"answer_email_sent_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at_label" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_thread_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"jurisdiction" char(2) NOT NULL,
	"internal_notes" text,
	"sender_name" text,
	"sender_email" text,
	"sender_phone" text,
	"import_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_events" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"skipped_reason" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"days_before" integer[] NOT NULL,
	"max_per_recipient" integer DEFAULT 2 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_tiles" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aggregate_target_usd" numeric(18, 2) NOT NULL,
	"flipit_share" numeric(9, 6) NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_events" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"snapshot_id" text,
	"kind" "template_kind" NOT NULL,
	"outcome" "send_outcome" NOT NULL,
	"message_id" text,
	"error_detail" text,
	"block_reason" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"service_mode" "service_mode" DEFAULT 'ACTIVE' NOT NULL,
	"sunset_closing_date" date,
	"service_contact_email" text,
	"closed_account_access" "closed_account_access" DEFAULT 'READ_ONLY' NOT NULL,
	"decimal_places" integer DEFAULT 3 NOT NULL,
	"approved_jurisdictions" text[] DEFAULT '{}' NOT NULL,
	"aggregate_raise_usd" numeric(18, 2) DEFAULT '30000' NOT NULL,
	"default_sender_name" text,
	"default_sender_email" text,
	"default_sender_phone" text,
	"qa_visible_during_raise" boolean DEFAULT true NOT NULL,
	"email_transport" "email_transport" DEFAULT 'SMTP' NOT NULL,
	"smtp_user_encrypted" text,
	"smtp_password_encrypted" text,
	"smtp_last_verified_at" timestamp with time zone,
	"smtp_last_verify_result" text,
	"open_ai_key_encrypted" text,
	"open_ai_model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"ai_monthly_cap_usd" numeric(10, 2) DEFAULT '20' NOT NULL,
	"ai_headers_only" boolean DEFAULT false NOT NULL,
	"last_export_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "update_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"update_id" text NOT NULL,
	"account_id" text NOT NULL,
	"notified_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "role" NOT NULL,
	"image" text,
	"onboarding_completed_at" timestamp with time zone,
	"display_name" text,
	"contact_method" "contact_method",
	"contact_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account_status_events" ADD CONSTRAINT "account_status_events_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_status_events" ADD CONSTRAINT "account_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_mappings" ADD CONSTRAINT "column_mappings_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_approvals" ADD CONSTRAINT "compliance_approvals_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_snapshots" ADD CONSTRAINT "email_snapshots_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds_receipts" ADD CONSTRAINT "funds_receipts_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds_receipts" ADD CONSTRAINT "funds_receipts_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_register_entries" ADD CONSTRAINT "interest_register_entries_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_register_entries" ADD CONSTRAINT "interest_register_entries_override_by_id_users_id_fk" FOREIGN KEY ("override_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_responses" ADD CONSTRAINT "investor_responses_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_sessions" ADD CONSTRAINT "investor_sessions_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_status_events" ADD CONSTRAINT "offer_status_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_status_events" ADD CONSTRAINT "offer_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_videos" ADD CONSTRAINT "operator_videos_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_certificates" ADD CONSTRAINT "participation_certificates_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_updates" ADD CONSTRAINT "portal_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_entries" ADD CONSTRAINT "qa_entries_asked_by_account_id_investor_accounts_id_fk" FOREIGN KEY ("asked_by_account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_entries" ADD CONSTRAINT "qa_entries_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_entries" ADD CONSTRAINT "qa_entries_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_thread_messages" ADD CONSTRAINT "qa_thread_messages_entry_id_qa_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."qa_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_thread_messages" ADD CONSTRAINT "qa_thread_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD CONSTRAINT "reminder_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_events" ADD CONSTRAINT "reminder_events_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_events" ADD CONSTRAINT "send_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_events" ADD CONSTRAINT "send_events_snapshot_id_email_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."email_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_events" ADD CONSTRAINT "send_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_deliveries" ADD CONSTRAINT "update_deliveries_update_id_portal_updates_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."portal_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_deliveries" ADD CONSTRAINT "update_deliveries_account_id_investor_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_status_events_account_idx" ON "account_status_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_proposals_job_idx" ON "ai_proposals" USING btree ("import_job_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "column_mappings_job_idx" ON "column_mappings" USING btree ("import_job_id");--> statement-breakpoint
CREATE INDEX "compliance_approvals_kind_idx" ON "compliance_approvals" USING btree ("template_kind","voided_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_account_idx" ON "conversation_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "document_packages_offer_idx" ON "document_packages" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "email_change_requests_account_idx" ON "email_change_requests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "email_snapshots_offer_idx" ON "email_snapshots" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "email_templates_kind_current_idx" ON "email_templates" USING btree ("kind","is_current");--> statement-breakpoint
CREATE INDEX "investor_accounts_status_idx" ON "investor_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investor_responses_offer_idx" ON "investor_responses" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "investor_sessions_account_idx" ON "investor_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_provider_account_idx" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "offer_status_events_offer_idx" ON "offer_status_events" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_recipient_idx" ON "offers" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "offers_round_stage_idx" ON "offers" USING btree ("round_id","stage");--> statement-breakpoint
CREATE INDEX "offers_account_idx" ON "offers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "offers_blocked_idx" ON "offers" USING btree ("blocked");--> statement-breakpoint
CREATE INDEX "operator_invites_email_idx" ON "operator_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "participation_certificates_offer_idx" ON "participation_certificates" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "portal_tokens_account_purpose_idx" ON "portal_tokens" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE INDEX "qa_entries_published_idx" ON "qa_entries" USING btree ("is_published","pinned","sort_order");--> statement-breakpoint
CREATE INDEX "qa_thread_messages_entry_idx" ON "qa_thread_messages" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_round_email_idx" ON "recipients" USING btree ("round_id","email");--> statement-breakpoint
CREATE INDEX "recipients_jurisdiction_idx" ON "recipients" USING btree ("jurisdiction");--> statement-breakpoint
CREATE INDEX "reminder_events_offer_idx" ON "reminder_events" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "reminder_events_due_idx" ON "reminder_events" USING btree ("scheduled_for","sent_at");--> statement-breakpoint
CREATE INDEX "send_events_offer_idx" ON "send_events" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "update_deliveries_unique_idx" ON "update_deliveries" USING btree ("update_id","account_id");