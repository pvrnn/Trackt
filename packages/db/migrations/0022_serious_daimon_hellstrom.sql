CREATE TYPE "public"."import_match_outcome" AS ENUM('below-threshold', 'tie');--> statement-breakpoint
CREATE TABLE "import_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"entry_key" text NOT NULL,
	"kind" "media_kind" NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"season_number" integer,
	"status" "log_status" NOT NULL,
	"outcome" "import_match_outcome" NOT NULL,
	"best_score" real NOT NULL,
	"candidates" jsonb NOT NULL,
	"entry" jsonb NOT NULL,
	"resolved_media_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_match" ADD CONSTRAINT "import_match_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_match" ADD CONSTRAINT "import_match_resolved_media_id_media_id_fk" FOREIGN KEY ("resolved_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_match_subject_idx" ON "import_match" USING btree ("user_id","source","entry_key");--> statement-breakpoint
CREATE INDEX "import_match_open_idx" ON "import_match" USING btree ("user_id","resolved_at");