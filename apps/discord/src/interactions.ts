import { MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import type { CommandRegistry } from './commands/index.js';

export async function handleInteraction(
  interaction: Interaction,
  registry: CommandRegistry,
  logger: Logger,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const command = registry.get(interaction.commandName);
  if (!command) {
    logger.warn({ command: interaction.commandName }, 'unknown slash command');
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error({ err: error, command: interaction.commandName }, 'slash command failed');
    const reply = {
      content: 'Something went wrong running that command.',
      flags: MessageFlags.Ephemeral,
    } as const;
    // Discord rejects a second reply(): once acknowledged, only followUp() is allowed.
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
}
