import { eq } from 'drizzle-orm';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import pino from 'pino';
import { createDb, deleteExpiredLinkCodes, discordNewsFeed } from '@trackt/db';
import { EnvValidationError, loadEnv } from '@trackt/shared';
import { commands, components, userCommands } from './commands/index.js';
import type { BotContext } from './context.js';
import { handleInteraction } from './interactions.js';
import { every } from './lib/every.js';
import { NEWS_POLL_INTERVAL_MS, pollNews } from './news/poller.js';
import { tickWatchParties, WATCH_PARTY_TICK_MS } from './watch-party/controller.js';

let env;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : {}),
});

if (!env.DISCORD_BOT_TOKEN) {
  logger.info('DISCORD_BOT_TOKEN is not set — Discord bot disabled');
  process.exit(0);
}

const LINK_CODE_SWEEP_MS = 60 * 60 * 1000;

const db = createDb(env.DATABASE_URL, { max: 3 });
const ctx: BotContext = { db, env, logger };
// Voice states tell a watch party who is in its voice channel; the intent is not privileged.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const stops: (() => void)[] = [];

client.once(Events.ClientReady, (ready) => {
  logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'discord bot ready');
  if (!env.CATALOG_URL) logger.info('CATALOG_URL is not set — news feeds will not post');
  stops.push(every(NEWS_POLL_INTERVAL_MS, 'news poll', () => pollNews(client, ctx), logger));
  stops.push(
    every(WATCH_PARTY_TICK_MS, 'watch party tick', () => tickWatchParties(client, ctx), logger),
  );
  stops.push(
    every(LINK_CODE_SWEEP_MS, 'link code sweep', () => deleteExpiredLinkCodes(db), logger),
  );
});
client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction, { commands, userCommands, components }, ctx).catch(
    (error: unknown) => {
      logger.error({ err: error }, 'failed to answer interaction');
    },
  );
});
client.on(Events.ChannelDelete, (channel) => {
  db.delete(discordNewsFeed)
    .where(eq(discordNewsFeed.channelId, channel.id))
    .catch((error: unknown) =>
      logger.warn({ err: error }, 'could not drop feeds of a deleted channel'),
    );
});
client.on(Events.GuildDelete, (guild) => {
  db.delete(discordNewsFeed)
    .where(eq(discordNewsFeed.guildId, guild.id))
    .catch((error: unknown) => logger.warn({ err: error }, 'could not drop feeds of a left guild'));
});
// Without a listener an 'error' event crashes the process; discord.js reconnects on its own.
client.on(Events.Error, (error) => {
  logger.warn({ err: error }, 'discord client error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'discord bot shutting down');
  for (const stop of stops) stop();
  await client.destroy();
  await db.$client.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await client.login(env.DISCORD_BOT_TOKEN);
