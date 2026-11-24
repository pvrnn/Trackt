CREATE TABLE "user_trophy" (
	"user_id" uuid NOT NULL,
	"trophy_id" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_trophy_user_id_trophy_id_pk" PRIMARY KEY("user_id","trophy_id")
);
--> statement-breakpoint
ALTER TABLE "user_trophy" ADD CONSTRAINT "user_trophy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_trophy_trophy_idx" ON "user_trophy" USING btree ("trophy_id","unlocked_at");--> statement-breakpoint
CREATE INDEX "user_trophy_unlocked_idx" ON "user_trophy" USING btree ("unlocked_at");