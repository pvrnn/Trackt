import { MessageFlags, type Interaction } from 'discord.js';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Command, CommandRegistry } from '../src/commands/index.js';
import { handleInteraction } from '../src/interactions.js';

const logger = pino({ level: 'silent' });

function fakeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: 'ping',
    replied: false,
    deferred: false,
    reply: vi.fn(),
    followUp: vi.fn(),
    ...overrides,
  };
}

function registryWith(execute: Command['execute']): CommandRegistry {
  return new Map([['ping', { data: { name: 'ping', description: 'ping' }, execute }]]);
}

describe('handleInteraction', () => {
  it('runs the matching command', async () => {
    const execute = vi.fn(async () => {});
    const interaction = fakeInteraction();
    await handleInteraction(interaction as unknown as Interaction, registryWith(execute), logger);
    expect(execute).toHaveBeenCalledWith(interaction);
  });

  it('ignores interactions that are not slash commands', async () => {
    const execute = vi.fn(async () => {});
    const interaction = fakeInteraction({ isChatInputCommand: () => false });
    await handleInteraction(interaction as unknown as Interaction, registryWith(execute), logger);
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores unknown commands', async () => {
    const interaction = fakeInteraction({ commandName: 'nope' });
    await handleInteraction(interaction as unknown as Interaction, registryWith(vi.fn()), logger);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('replies ephemerally when a command throws', async () => {
    const interaction = fakeInteraction();
    const failing = registryWith(async () => {
      throw new Error('boom');
    });
    await handleInteraction(interaction as unknown as Interaction, failing, logger);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it('follows up instead of replying when the command already answered', async () => {
    const interaction = fakeInteraction({ replied: true });
    const failing = registryWith(async () => {
      throw new Error('boom');
    });
    await handleInteraction(interaction as unknown as Interaction, failing, logger);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalled();
  });
});
