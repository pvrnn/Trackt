import { REST, Routes } from 'discord.js';
import { loadEnv } from '@trackt/shared';
import { commands } from './commands/index.js';

const env = loadEnv();
if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID to register slash commands.');
  process.exit(1);
}

const body = [...commands.values()].map((command) => command.data);
const rest = new REST().setToken(env.DISCORD_BOT_TOKEN);
// Guild commands update instantly; global ones can take up to an hour to propagate.
const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_APPLICATION_ID);

await rest.put(route, { body });
console.log(
  `Registered ${body.length} command(s) ${env.DISCORD_GUILD_ID ? `on guild ${env.DISCORD_GUILD_ID}` : 'globally'}.`,
);
