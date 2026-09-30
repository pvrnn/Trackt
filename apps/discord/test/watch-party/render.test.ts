import { describe, expect, it } from 'vitest';
import { renderParty, itemLabel, type PartyView } from '../../src/watch-party/render.js';

const now = new Date('2026-09-30T20:30:00Z');
const ID = '00000000-0000-4000-8000-000000000001';

function view(overrides: Partial<PartyView> = {}): PartyView {
  return {
    id: ID,
    status: 'scheduled',
    hostDiscordId: '111',
    scheduledAt: new Date('2026-09-30T21:00:00Z'),
    endedAt: null,
    voiceChannelId: null,
    clock: { itemStartedAt: null, pausedAt: null, pausedMs: 0 },
    durationSeconds: 47 * 60,
    media: {
      title: 'Breaking Bad',
      slug: 'breaking-bad-2008',
      kind: 'series',
      year: 2008,
      seasonNumber: 1,
      coverUrl: 'https://image.tmdb.org/t/p/w500/bb.jpg',
    },
    partNumber: 3,
    partTitle: "...And the Bag's in the River",
    rsvps: [
      { discordUserId: '201', response: 'going' },
      { discordUserId: '202', response: 'maybe' },
      { discordUserId: '203', response: 'declined' },
    ],
    hasNext: true,
    ...overrides,
  };
}

function customIds(rendered: ReturnType<typeof renderParty>): string[] {
  return rendered.components.flatMap((row) =>
    row.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')),
  );
}

describe('itemLabel', () => {
  it('names episodes by season and number', () => {
    expect(itemLabel(view())).toBe("S1E3 · ...And the Bag's in the River");
    expect(itemLabel(view({ partTitle: null }))).toBe('S1E3');
    expect(itemLabel(view({ partNumber: null }))).toBe('Breaking Bad');
  });
});

describe('renderParty', () => {
  it('announces a scheduled party with RSVPs and host controls', () => {
    const rendered = renderParty(view(), 'https://trackt.example', now);
    const embed = rendered.embeds[0]!.toJSON();
    expect(embed.url).toBe('https://trackt.example/media/breaking-bad-2008');
    expect(embed.description).toContain('Starts <t:1790802000:F>');
    expect(embed.fields?.map((f) => [f.name, f.value])).toEqual([
      ['✅ Going (1)', '<@201>'],
      ['🤔 Maybe (1)', '<@202>'],
      ['❌ Declined', '1'],
    ]);
    expect(customIds(rendered)).toEqual([
      `wp:rsvp:${ID}:going`,
      `wp:rsvp:${ID}:maybe`,
      `wp:rsvp:${ID}:declined`,
      `wp:start:${ID}`,
      `wp:cancel:${ID}`,
    ]);
  });

  it('shows progress and when a live item ends', () => {
    const rendered = renderParty(
      view({
        status: 'live',
        voiceChannelId: '999',
        clock: { itemStartedAt: new Date('2026-09-30T20:00:00Z'), pausedAt: null, pausedMs: 0 },
      }),
      'https://trackt.example',
      now,
    );
    const description = rendered.embeds[0]!.toJSON().description!;
    expect(description).toContain('▶️ Live · 30:00 / 47:00');
    expect(description).toContain('Ends <t:1790801220:R>');
    expect(description).toContain('🔊 Join <#999>');
    expect(customIds(rendered).slice(3)).toEqual([
      `wp:pause:${ID}`,
      `wp:next:${ID}`,
      `wp:end:${ID}`,
    ]);
  });

  it('says so once the item has run its length', () => {
    const rendered = renderParty(
      view({
        status: 'live',
        clock: { itemStartedAt: new Date('2026-09-30T19:00:00Z'), pausedAt: null, pausedMs: 0 },
      }),
      'https://trackt.example',
      now,
    );
    expect(rendered.embeds[0]!.toJSON().description).toContain('47:00 / 47:00');
    expect(rendered.embeds[0]!.toJSON().description).toContain(
      'the host can start the next episode',
    );
  });

  it('copes without a runtime', () => {
    const rendered = renderParty(
      view({
        status: 'live',
        durationSeconds: null,
        clock: { itemStartedAt: new Date('2026-09-30T20:00:00Z'), pausedAt: null, pausedMs: 0 },
      }),
      'https://trackt.example',
      now,
    );
    expect(rendered.embeds[0]!.toJSON().description).toContain('30:00 in · runtime unknown');
  });

  it('offers Resume while paused, and no Next for a movie', () => {
    const rendered = renderParty(
      view({
        status: 'live',
        partNumber: null,
        media: { ...view().media, kind: 'movie' },
        clock: {
          itemStartedAt: new Date('2026-09-30T20:00:00Z'),
          pausedAt: new Date('2026-09-30T20:10:00Z'),
          pausedMs: 0,
        },
      }),
      'https://trackt.example',
      now,
    );
    expect(rendered.embeds[0]!.toJSON().description).toContain('⏸ Paused · 10:00 / 47:00');
    expect(customIds(rendered).slice(3)).toEqual([`wp:resume:${ID}`, `wp:end:${ID}`]);
  });

  it('drops every control once over', () => {
    const rendered = renderParty(view({ status: 'ended', endedAt: now }), 'https://t.example', now);
    expect(rendered.components).toEqual([]);
  });
});
