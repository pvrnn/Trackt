import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIContextMenuApplicationCommandsJSONBody,
  UserContextMenuCommandInteraction,
} from 'discord.js';
import type { BotContext } from '../context.js';
import { link, linkComponents, unlink } from './link.js';
import { newsfeed, newsfeedComponents } from './newsfeed.js';
import { ping } from './ping.js';
import { profile, profileContextMenu } from './profile.js';

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void>;
}

export type CommandRegistry = ReadonlyMap<string, Command>;

/** A right-click → Apps entry on a member. */
export interface UserCommand {
  data: RESTPostAPIContextMenuApplicationCommandsJSONBody;
  execute(interaction: UserContextMenuCommandInteraction, ctx: BotContext): Promise<void>;
}

export type UserCommandRegistry = ReadonlyMap<string, UserCommand>;

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
  [ping, newsfeed, link, unlink, profile].map((command) => [command.data.name, command]),
);

export const userCommands: UserCommandRegistry = new Map(
  [profileContextMenu].map((command) => [command.data.name, command]),
);

export const components: ComponentRegistry = new Map(
  [newsfeedComponents, linkComponents].map((handler) => [handler.prefix, handler]),
);
