CREATE TABLE "discord_news_feed" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"kinds" "media_kind"[] DEFAULT '{}' NOT NULL,
	"cursor_published_at" timestamp with time zone NOT NULL,
	"cursor_article_id" uuid,
	"created_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_news_feed_guild_id_channel_id_pk" PRIMARY KEY("guild_id","channel_id")
);
