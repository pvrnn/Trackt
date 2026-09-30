import { MessageFlags, type Interaction } from 'discord.js';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Command, ComponentHandler, UserCommand } from '../src/commands/index.js';
import type { BotContext } from '../src/context.js';
import { handleInteraction, type Registries } from '../src/interactions.js';

const ctx = { logger: pino({ level: 'silent' }) } as unknown as BotContext;

function fakeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isUserContextMenuCommand: () => false,
    commandName: 'ping',
    customId: '',
    replied: false,
    deferred: false,
    responded: false,
    reply: vi.fn(),
    followUp: vi.fn(),
    respond: vi.fn(),
    ...overrides,
  };
}

function fakeComponent(customId: string, overrides: Record<string, unknown> = {}) {
  return fakeInteraction({
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    customId,
    ...overrides,
  });
}

function registriesWith(
  command: Partial<Command> = {},
  component?: ComponentHandler['handle'],
  userCommand?: UserCommand['execute'],
): Registries {
  return {
    commands: new Map([
      ['ping', { data: { name: 'ping', description: 'ping' }, execute: vi.fn(), ...command }],
    ]),
    userCommands: new Map(
      userCommand
        ? [['Trackt profile', { data: { name: 'Trackt profile', type: 2 }, execute: userCommand }]]
        : [],
    ),
    components: new Map(component ? [['feed', { prefix: 'feed', handle: component }]] : []),
  };
}

const boom = async () => {
  throw new Error('boom');
};

describe('handleInteraction', () => {
  describe('slash commands', () => {
    it('runs the matching command with the context', async () => {
      const execute = vi.fn(async () => {});
      const interaction = fakeInteraction();
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({ execute }),
        ctx,
      );
      expect(execute).toHaveBeenCalledWith(interaction, ctx);
    });

    it('ignores unknown commands', async () => {
      const interaction = fakeInteraction({ commandName: 'nope' });
      await handleInteraction(interaction as unknown as Interaction, registriesWith(), ctx);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('replies ephemerally when a command throws', async () => {
      const interaction = fakeInteraction();
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({ execute: boom }),
        ctx,
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      );
    });

    it('follows up instead of replying when the command already answered', async () => {
      const interaction = fakeInteraction({ replied: true });
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({ execute: boom }),
        ctx,
      );
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalled();
    });
  });

  describe('autocomplete', () => {
    it("routes to the command's autocomplete", async () => {
      const autocomplete = vi.fn(async () => {});
      const interaction = fakeInteraction({ isAutocomplete: () => true });
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({ autocomplete }),
        ctx,
      );
      expect(autocomplete).toHaveBeenCalledWith(interaction, ctx);
    });

    it('answers with no choices when autocomplete throws', async () => {
      const interaction = fakeInteraction({ isAutocomplete: () => true });
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({ autocomplete: boom }),
        ctx,
      );
      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('components', () => {
    it('routes by the custom id prefix', async () => {
      const handle = vi.fn(async () => {});
      const interaction = fakeComponent('feed:kinds:123');
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({}, handle),
        ctx,
      );
      expect(handle).toHaveBeenCalledWith(interaction, ctx);
    });

    it('ignores components nobody owns', async () => {
      const handle = vi.fn(async () => {});
      const interaction = fakeComponent('other:thing');
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({}, handle),
        ctx,
      );
      expect(handle).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('replies ephemerally when a handler throws', async () => {
      const interaction = fakeComponent('feed:kinds:123');
      await handleInteraction(interaction as unknown as Interaction, registriesWith({}, boom), ctx);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      );
    });
  });

  describe('user context menu commands', () => {
    it('routes by command name', async () => {
      const execute = vi.fn(async () => {});
      const interaction = fakeInteraction({
        isChatInputCommand: () => false,
        isUserContextMenuCommand: () => true,
        commandName: 'Trackt profile',
      });
      await handleInteraction(
        interaction as unknown as Interaction,
        registriesWith({}, undefined, execute),
        ctx,
      );
      expect(execute).toHaveBeenCalledWith(interaction, ctx);
    });
  });
});
