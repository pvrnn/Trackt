CREATE TYPE "public"."import_run_state" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"profile" text NOT NULL,
	"overwrite" boolean DEFAULT false NOT NULL,
	"state" "import_run_state" DEFAULT 'queued' NOT NULL,
	"job_id" text NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_kind" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_run_user_idx" ON "import_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_run_live_idx" ON "import_run" USING btree ("user_id","source") WHERE "import_run"."state" in ('queued', 'running');