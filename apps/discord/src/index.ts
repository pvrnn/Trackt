import { Client, Events, GatewayIntentBits } from 'discord.js';
import pino from 'pino';
import { EnvValidationError, loadEnv } from '@trackt/shared';
import { commands } from './commands/index.js';
import { handleInteraction } from './interactions.js';

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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'discord bot ready');
});
client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction, commands, logger).catch((error: unknown) => {
    logger.error({ err: error }, 'failed to answer interaction');
  });
});
// Without a listener an 'error' event crashes the process; discord.js reconnects on its own.
client.on(Events.Error, (error) => {
  logger.warn({ err: error }, 'discord client error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'discord bot shutting down');
  await client.destroy();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await client.login(env.DISCORD_BOT_TOKEN);
