CREATE TABLE "news_article" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"dek" text,
	"body" text NOT NULL,
	"topic" text NOT NULL,
	"kinds" text[] DEFAULT '{}' NOT NULL,
	"cover_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_article_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "news_article_media" (
	"article_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "news_article_media_article_id_media_id_role_pk" PRIMARY KEY("article_id","media_id","role")
);
--> statement-breakpoint
CREATE TABLE "news_article_source" (
	"article_id" uuid NOT NULL,
	"url" text NOT NULL,
	"outlet" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "news_article_source_article_id_url_pk" PRIMARY KEY("article_id","url")
);
--> statement-breakpoint
CREATE TABLE "news_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"feed_url" text NOT NULL,
	"homepage_url" text,
	"kinds" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_source_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
CREATE TABLE "news_source_item" (
	"source_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"article_id" uuid,
	CONSTRAINT "news_source_item_source_id_guid_pk" PRIMARY KEY("source_id","guid")
);
--> statement-breakpoint
ALTER TABLE "news_article_media" ADD CONSTRAINT "news_article_media_article_id_news_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article_media" ADD CONSTRAINT "news_article_media_media_id_catalog_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."catalog_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article_source" ADD CONSTRAINT "news_article_source_article_id_news_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_source_item" ADD CONSTRAINT "news_source_item_source_id_news_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."news_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_source_item" ADD CONSTRAINT "news_source_item_article_id_news_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_article"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_article_feed_idx" ON "news_article" USING btree ("status","published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "news_article_kinds_idx" ON "news_article" USING gin ("kinds");--> statement-breakpoint
CREATE INDEX "news_article_topic_idx" ON "news_article" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "news_article_media_media_idx" ON "news_article_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "news_source_enabled_idx" ON "news_source" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "news_source_item_status_idx" ON "news_source_item" USING btree ("status","seen_at");