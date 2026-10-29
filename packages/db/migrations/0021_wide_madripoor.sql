CREATE TABLE "feature_flag_override" (
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_override_key_user_id_pk" PRIMARY KEY("key","user_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rollout" smallint DEFAULT 100 NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "feature_flag_rollout_range" CHECK ("feature_flag"."rollout" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "feature_flag_override" ADD CONSTRAINT "feature_flag_override_key_feature_flag_key_fk" FOREIGN KEY ("key") REFERENCES "public"."feature_flag"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_override" ADD CONSTRAINT "feature_flag_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_flag_override_user_idx" ON "feature_flag_override" USING btree ("user_id");