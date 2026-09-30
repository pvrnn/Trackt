import { MessageFlags, type Interaction, type RepliableInteraction } from 'discord.js';
import type { CommandRegistry, ComponentRegistry } from './commands/index.js';
import type { BotContext } from './context.js';

export interface Registries {
  commands: CommandRegistry;
  components: ComponentRegistry;
}

export async function handleInteraction(
  interaction: Interaction,
  registries: Registries,
  ctx: BotContext,
): Promise<void> {
  const { logger } = ctx;

  if (interaction.isAutocomplete()) {
    const command = registries.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction, ctx);
    } catch (error) {
      logger.error({ err: error, command: interaction.commandName }, 'autocomplete failed');
      if (!interaction.responded) await interaction.respond([]);
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = registries.commands.get(interaction.commandName);
    if (!command) {
      logger.warn({ command: interaction.commandName }, 'unknown slash command');
      return;
    }
    try {
      await command.execute(interaction, ctx);
    } catch (error) {
      logger.error({ err: error, command: interaction.commandName }, 'slash command failed');
      await replyWithError(interaction);
    }
    return;
  }

  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const prefix = interaction.customId.split(':', 1)[0] ?? '';
    const handler = registries.components.get(prefix);
    if (!handler) {
      logger.warn({ customId: interaction.customId }, 'unknown component');
      return;
    }
    try {
      await handler.handle(interaction, ctx);
    } catch (error) {
      logger.error({ err: error, customId: interaction.customId }, 'component handler failed');
      await replyWithError(interaction);
    }
  }
}

async function replyWithError(interaction: RepliableInteraction): Promise<void> {
  const reply = {
    content: 'Something went wrong running that command.',
    flags: MessageFlags.Ephemeral,
  } as const;
  // Discord rejects a second reply(): once acknowledged, only followUp() is allowed.
  if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
  else await interaction.reply(reply);
}
