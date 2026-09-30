import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { BotContext } from '../context.js';
import { newsfeed, newsfeedComponents } from './newsfeed.js';
import { ping } from './ping.js';

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void>;
}

export type CommandRegistry = ReadonlyMap<string, Command>;

/**
 * Buttons, select menus and modals route by the first segment of their custom
 * id — `feature:action:arg…` — so a handler owns every component it emits.
 */
export interface ComponentHandler {
  prefix: string;
  handle(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    ctx: BotContext,
  ): Promise<void>;
}

export type ComponentRegistry = ReadonlyMap<string, ComponentHandler>;

export const commands: CommandRegistry = new Map(
  [ping, newsfeed].map((command) => [command.data.name, command]),
);

export const components: ComponentRegistry = new Map(
  [newsfeedComponents].map((handler) => [handler.prefix, handler]),
);
