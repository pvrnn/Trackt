import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ChannelType, type Client } from 'discord.js';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  discordLink,
  discordWatchParty,
  runMigrations,
  seedMedia,
  userMedia,
  users,
  type Db,
} from '@trackt/db';
import { canonicalMediaId, loadEnv } from '@trackt/shared';
import type { BotContext } from '../../src/context.js';
import { tickWatchParties } from '../../src/watch-party/controller.js';
import { loadParty } from '../../src/watch-party/service.js';
import { testDatabase } from '../support/database.js';

const TEST_DATABASE_URL = await testDatabase('trackt_discord_watch_tick_test');
const matrix = canonicalMediaId('movie', 603);
const MINUTE = 60_000;

/** A guild with one text channel (the announcement) and whatever voice channel gets created. */
function fakeDiscord(inVoice: { id: string; bot: boolean }[] = []) {
  const voice = {
    isVoiceBased: () => true,
    members: new Map(inVoice.map((m) => [m.id, { id: m.id, user: { bot: m.bot } }])),
  };
  const category = { id: 'category-1', type: ChannelType.GuildCategory };
  const announcement = { isThread: () => false, parent: category };
  const guild = {
    channels: {
      create: vi.fn(async () => ({ id: 'voice-1' })),
      delete: vi.fn(async () => {}),
      cache: new Map<string, unknown>([
        ['voice-1', voice],
        ['2', announcement],
      ]),
    },
  };
  const text = {
    isSendable: () => true,
    isDMBased: () => false,
    send: vi.fn(async () => ({})),
    messages: { edit: vi.fn(async () => ({})) },
  };
  const client = {
    guilds: { fetch: vi.fn(async () => guild) },
    channels: { fetch: vi.fn(async () => text) },
  } as unknown as Client;
  return { client, guild, text };
}

describe.runIf(TEST_DATABASE_URL)('tickWatchParties (postgres)', () => {
  let db: Db;
  let ctx: BotContext;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL!);
    db = createDb(TEST_DATABASE_URL!, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'https://trackt.example' });
    ctx = { db, env, logger: pino({ level: 'silent' }) };
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    await db.delete(discordWatchParty);
  });

  async function party(overrides: Partial<typeof discordWatchParty.$inferInsert>) {
    const [row] = await db
      .insert(discordWatchParty)
      .values({
        guildId: '1',
        channelId: '2',
        messageId: 'announcement-1',
        hostDiscordId: '3',
        mediaId: matrix,
        scheduledAt: new Date(),
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('opens the voice channel shortly before the start and pings who is coming', async () => {
    const row = await party({ scheduledAt: new Date(Date.now() + 10 * MINUTE) });
    const { client, guild, text } = fakeDiscord();

    await tickWatchParties(client, ctx);

    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '🍿 The Matrix', parent: 'category-1' }),
    );
    expect((await loadParty(db, row.id))?.voiceChannelId).toBe('voice-1');
    expect(text.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('join <#voice-1>') }),
    );
  });

  it('leaves a party that is still far off alone', async () => {
    await party({ scheduledAt: new Date(Date.now() + 60 * MINUTE) });
    const { client, guild } = fakeDiscord();
    await tickWatchParties(client, ctx);
    expect(guild.channels.create).not.toHaveBeenCalled();
  });

  it('marks a finished movie watched for linked members in voice, then ends the party', async () => {
    const discordId = `${Date.now()}`;
    const username = `t${randomUUID().slice(0, 12)}`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Viewer', email: `${username}@example.com`, username })
      .returning({ id: users.id });
    await db
      .insert(discordLink)
      .values({ userId: user!.id, discordUserId: discordId, discordUsername: username });

    const row = await party({
      status: 'live',
      voiceChannelId: 'voice-1',
      itemStartedAt: new Date(Date.now() - 140 * MINUTE),
      durationSeconds: 136 * 60,
    });
    const { client, text } = fakeDiscord([
      { id: discordId, bot: false },
      { id: 'stranger', bot: false },
      { id: 'music-bot', bot: true },
    ]);

    await tickWatchParties(client, ctx);

    const [log] = await db
      .select()
      .from(userMedia)
      .where(and(eq(userMedia.userId, user!.id), eq(userMedia.mediaId, matrix)));
    expect(log?.status).toBe('completed');
    const summary = (text.send.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(summary).toContain(`<@${discordId}>`);
    expect(summary).toContain("<@stranger> isn't linked");
    expect(summary).not.toContain('music-bot');
    expect((await loadParty(db, row.id))?.status).toBe('ended');
    expect(text.messages.edit).toHaveBeenCalled();
  });

  it('keeps counting while an item is still running', async () => {
    const row = await party({
      status: 'live',
      itemStartedAt: new Date(Date.now() - 30 * MINUTE),
      durationSeconds: 136 * 60,
    });
    const { client, text } = fakeDiscord();
    await tickWatchParties(client, ctx);
    expect(text.messages.edit).toHaveBeenCalledTimes(1);
    expect((await loadParty(db, row.id))?.status).toBe('live');
  });

  it('closes the voice channel a few minutes after the end', async () => {
    const row = await party({
      status: 'ended',
      voiceChannelId: 'voice-1',
      endedAt: new Date(Date.now() - 6 * MINUTE),
    });
    const { client, guild } = fakeDiscord();
    await tickWatchParties(client, ctx);
    expect(guild.channels.delete).toHaveBeenCalledWith('voice-1', expect.any(String));
    expect((await loadParty(db, row.id))?.voiceChannelId).toBeNull();
  });

  it('gives up on a party nobody started', async () => {
    const row = await party({ scheduledAt: new Date(Date.now() - 7 * 60 * MINUTE) });
    const { client } = fakeDiscord();
    await tickWatchParties(client, ctx);
    expect((await loadParty(db, row.id))?.status).toBe('cancelled');
  });
});
