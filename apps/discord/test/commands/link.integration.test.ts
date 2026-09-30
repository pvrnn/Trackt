import { randomUUID } from 'node:crypto';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, redeemLinkCode, runMigrations, users, type Db } from '@trackt/db';
import { loadEnv } from '@trackt/shared';
import { link, unlink } from '../../src/commands/link.js';
import type { BotContext } from '../../src/context.js';
import { findLinkedUser } from '../../src/linking.js';
import { available, TEST_DATABASE_URL } from '../support/database.js';

function fakeCommand(discordUserId: string) {
  return {
    user: { id: discordUserId, username: `user${discordUserId.slice(-4)}` },
    reply: vi.fn(async () => {}),
  };
}

type Reply = { content: string; flags: number; components: { toJSON(): unknown }[] };

function lastReply(interaction: ReturnType<typeof fakeCommand>): Reply {
  return (interaction.reply.mock.calls.at(-1) as unknown as [Reply])[0];
}

describe.runIf(available)('/link and /unlink (postgres)', () => {
  let db: Db;
  let ctx: BotContext;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'https://trackt.example' });
    ctx = { db, env, logger: pino({ level: 'silent' }) };
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  async function trackUser(): Promise<{ id: string; username: string }> {
    const username = `u${randomUUID().slice(0, 12)}`;
    const [row] = await db
      .insert(users)
      .values({ name: 'Linker', email: `${username}@example.com`, username })
      .returning({ id: users.id });
    return { id: row!.id, username };
  }

  it('hands out a private one-time link, then reports the link once redeemed', async () => {
    const discordUserId = `${Date.now()}`;
    const first = fakeCommand(discordUserId);
    await link.execute(first as unknown as ChatInputCommandInteraction, ctx);

    const reply = lastReply(first);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    const button = JSON.stringify(reply.components[0]!.toJSON());
    const code = /code=([A-Za-z0-9_-]{43})/.exec(button)?.[1];
    expect(button).toContain('https://trackt.example/link/discord?code=');
    expect(code).toBeDefined();

    const trackt = await trackUser();
    await redeemLinkCode(db, trackt.id, code!);
    expect(await findLinkedUser(db, discordUserId)).toEqual({
      userId: trackt.id,
      username: trackt.username,
    });

    const again = fakeCommand(discordUserId);
    await link.execute(again as unknown as ChatInputCommandInteraction, ctx);
    expect(lastReply(again).content).toContain(`@${trackt.username}`);

    const leave = fakeCommand(discordUserId);
    await unlink.execute(leave as unknown as ChatInputCommandInteraction, ctx);
    expect(lastReply(leave).content).toBe('Unlinked from Trackt.');
    expect(await findLinkedUser(db, discordUserId)).toBeNull();
  });
});
