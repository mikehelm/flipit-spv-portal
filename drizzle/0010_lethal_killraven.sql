CREATE TABLE "acknowledgement_items" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_acknowledgements" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"item_id" text,
	"label" text NOT NULL,
	"revision" integer NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_acknowledgements" ADD CONSTRAINT "response_acknowledgements_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_acknowledgements" ADD CONSTRAINT "response_acknowledgements_item_id_acknowledgement_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."acknowledgement_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "response_acknowledgements_offer_idx" ON "response_acknowledgements" USING btree ("offer_id","acknowledged_at");