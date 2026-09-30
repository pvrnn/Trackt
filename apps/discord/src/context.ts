import type { Db } from '@trackt/db';
import type { Env } from '@trackt/shared';
import type { Logger } from 'pino';

/** What every command and component handler is handed alongside its interaction. */
export interface BotContext {
  db: Db;
  env: Env;
  logger: Logger;
}
