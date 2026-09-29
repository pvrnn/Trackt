import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { ping } from './ping.js';

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export type CommandRegistry = ReadonlyMap<string, Command>;

export const commands: CommandRegistry = new Map(
  [ping].map((command) => [command.data.name, command]),
);
