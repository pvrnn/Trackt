CREATE TABLE "friendship" (
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "friendship_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friendship_user_a_id_user_b_id_pk" PRIMARY KEY("user_a_id","user_b_id"),
	CONSTRAINT "friendship_pair_ordered" CHECK ("friendship"."user_a_id" < "friendship"."user_b_id"),
	CONSTRAINT "friendship_requester_member" CHECK ("friendship"."requested_by" = "friendship"."user_a_id" OR "friendship"."requested_by" = "friendship"."user_b_id")
);
--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_a_id_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_b_id_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendship_user_b_idx" ON "friendship" USING btree ("user_b_id","status");