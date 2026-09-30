import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  PART_KIND_BY_MEDIA,
  type MediaKind,
  type RsvpResponse,
  type WatchPartyStatus,
} from '@trackt/shared';
import { TRACKT_COLOR } from '../news/embed.js';
import { embeddableUrl, instanceUrl } from '../lib/urls.js';
import { elapsedMs, formatDuration, progressBar, type PartyClock } from './clock.js';

export const WP_PREFIX = 'wp';

/** Everything the announcement shows; built from the party row, its media and its RSVPs. */
export interface PartyView {
  id: string;
  status: WatchPartyStatus;
  hostDiscordId: string;
  scheduledAt: Date;
  endedAt: Date | null;
  voiceChannelId: string | null;
  clock: PartyClock;
  durationSeconds: number | null;
  media: {
    title: string;
    slug: string;
    kind: MediaKind;
    year: number | null;
    seasonNumber: number | null;
    coverUrl: string | null;
  };
  partNumber: number | null;
  partTitle: string | null;
  rsvps: { discordUserId: string; response: RsvpResponse }[];
  hasNext: boolean;
}

const FIELD_MAX = 1024;
const unix = (date: Date) => Math.floor(date.getTime() / 1000);

/** `S2E3`, or `E3` for a work without season numbers. */
export function episodeCode(seasonNumber: number | null, partNumber: number): string {
  return seasonNumber !== null ? `S${seasonNumber}E${partNumber}` : `E${partNumber}`;
}

/** What is on screen: the movie, or `S2E3 · Title`. */
export function itemLabel(view: Pick<PartyView, 'media' | 'partNumber' | 'partTitle'>): string {
  if (view.partNumber === null) return view.media.title;
  const code = episodeCode(view.media.seasonNumber, view.partNumber);
  return view.partTitle ? `${code} · ${view.partTitle}` : code;
}

export function isItemFinished(view: PartyView, now: Date): boolean {
  return view.durationSeconds !== null && elapsedMs(view.clock, now) >= view.durationSeconds * 1000;
}

function mentions(ids: string[]): string {
  if (ids.length === 0) return '—';
  let out = '';
  for (const [index, id] of ids.entries()) {
    const next = out ? `${out} <@${id}>` : `<@${id}>`;
    if (next.length > FIELD_MAX - 16) return `${out} +${ids.length - index} more`;
    out = next;
  }
  return out;
}

function statusLines(view: PartyView, now: Date): string[] {
  switch (view.status) {
    case 'scheduled':
      return [`Starts <t:${unix(view.scheduledAt)}:F> (<t:${unix(view.scheduledAt)}:R>)`];
    case 'cancelled':
      return ['Cancelled.'];
    case 'ended':
      return [view.endedAt ? `Ended <t:${unix(view.endedAt)}:R>.` : 'Ended.'];
    case 'live': {
      const elapsed = elapsedMs(view.clock, now);
      const paused = view.clock.pausedAt !== null;
      if (view.durationSeconds === null) {
        return [
          `${paused ? '⏸ Paused' : '▶️ Live'} · ${formatDuration(elapsed)} in · runtime unknown`,
        ];
      }
      const total = view.durationSeconds * 1000;
      const lines = [
        `${paused ? '⏸ Paused' : '▶️ Live'} · ${formatDuration(Math.min(elapsed, total))} / ${formatDuration(total)}`,
        progressBar(elapsed / total),
      ];
      if (elapsed >= total) {
        lines.push(view.hasNext ? 'Finished — the host can start the next episode.' : 'Finished.');
      } else if (!paused) {
        lines.push(`Ends <t:${unix(new Date(now.getTime() + total - elapsed))}:R>`);
      }
      return lines;
    }
  }
}

function button(id: string, action: string, label: string, style: ButtonStyle, arg?: string) {
  return new ButtonBuilder()
    .setCustomId([WP_PREFIX, action, id, ...(arg ? [arg] : [])].join(':'))
    .setLabel(label)
    .setStyle(style);
}

export function renderParty(view: PartyView, appUrl: string, now: Date) {
  const heading =
    view.media.year && view.partNumber === null
      ? `${view.media.title} (${view.media.year})`
      : view.media.title;
  const lines = [
    ...(view.partNumber !== null ? [`**${itemLabel(view)}**`] : []),
    `Hosted by <@${view.hostDiscordId}>`,
    ...statusLines(view, now),
    ...(view.voiceChannelId && (view.status === 'scheduled' || view.status === 'live')
      ? [`🔊 Join <#${view.voiceChannelId}>`]
      : []),
  ];
  const byResponse = (response: RsvpResponse) =>
    view.rsvps.filter((rsvp) => rsvp.response === response).map((rsvp) => rsvp.discordUserId);
  const going = byResponse('going');
  const maybe = byResponse('maybe');
  const declined = byResponse('declined');

  const embed = new EmbedBuilder()
    .setColor(TRACKT_COLOR)
    .setTitle(`🍿 Watch party: ${heading}`.slice(0, 256))
    .setURL(instanceUrl(`/media/${encodeURIComponent(view.media.slug)}`, appUrl))
    .setDescription(lines.join('\n'))
    .addFields(
      { name: `✅ Going (${going.length})`, value: mentions(going) },
      { name: `🤔 Maybe (${maybe.length})`, value: mentions(maybe) },
      { name: '❌ Declined', value: String(declined.length), inline: true },
    )
    .setFooter({ text: 'Trackt watch party · linked members in voice get it marked watched' });
  const cover = embeddableUrl(view.media.coverUrl, appUrl);
  if (cover) embed.setThumbnail(cover);

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (view.status === 'scheduled' || view.status === 'live') {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(view.id, 'rsvp', 'Join', ButtonStyle.Success, 'going'),
        button(view.id, 'rsvp', 'Maybe', ButtonStyle.Secondary, 'maybe'),
        button(view.id, 'rsvp', 'Decline', ButtonStyle.Secondary, 'declined'),
      ),
    );
  }
  if (view.status === 'scheduled') {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(view.id, 'start', 'Start', ButtonStyle.Primary),
        button(view.id, 'cancel', 'Cancel', ButtonStyle.Danger),
      ),
    );
  }
  if (view.status === 'live') {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      view.clock.pausedAt
        ? button(view.id, 'resume', 'Resume', ButtonStyle.Primary)
        : button(view.id, 'pause', 'Pause', ButtonStyle.Secondary),
    );
    if (PART_KIND_BY_MEDIA[view.media.kind]) {
      row.addComponents(
        button(view.id, 'next', 'Next episode', ButtonStyle.Primary).setDisabled(!view.hasNext),
      );
    }
    row.addComponents(button(view.id, 'end', 'End', ButtonStyle.Danger));
    components.push(row);
  }
  return { embeds: [embed], components };
}
