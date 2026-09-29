import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './index.js';

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is up')
    .toJSON(),
  async execute(interaction) {
    await interaction.reply({
      content: `Pong! (${Math.round(interaction.client.ws.ping)} ms)`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
