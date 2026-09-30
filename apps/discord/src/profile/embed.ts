import { EmbedBuilder } from 'discord.js';
import { trackingVerbLabel, type ActivityEntry, type PublicProfile } from '@trackt/shared';
import { TRACKT_COLOR } from '../news/embed.js';
import { embeddableUrl, instanceUrl } from '../lib/urls.js';

const FAVORITES_SHOWN = 5;
const ACTIVITY_SHOWN = 5;
/** Discord's cap on an embed field value. */
const FIELD_MAX = 1024;

function mediaLink(title: string, slug: string, appUrl: string): string {
  // Brackets would close the markdown link early.
  const safe = title.replace(/[[\]]/g, '');
  return `[${safe}](${instanceUrl(`/media/${encodeURIComponent(slug)}`, appUrl)})`;
}

function activityLine(entry: ActivityEntry, appUrl: string): string {
  const verb =
    entry.verb === 'checked_in'
      ? trackingVerbLabel(entry.kind)
      : entry.verb === 'rated'
        ? 'Rated'
        : 'Marked';
  const at = Math.floor(Date.parse(entry.at) / 1000);
  return `${verb} ${mediaLink(entry.title, entry.slug, appUrl)} **${entry.detail}** · <t:${at}:R>`;
}

/** Whole lines only: a line cut in half would break its markdown link. */
function joinWithin(lines: string[], separator: string, max = FIELD_MAX): string {
  let out = '';
  for (const line of lines) {
    const next = out ? `${out}${separator}${line}` : line;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

export function profileEmbed(profile: PublicProfile, appUrl: string): EmbedBuilder {
  const { user, stats } = profile;
  const embed = new EmbedBuilder()
    .setColor(TRACKT_COLOR)
    .setAuthor({
      name: `${user.name} (@${user.username})`.slice(0, 256),
      url: instanceUrl(`/users/${encodeURIComponent(user.username)}`, appUrl),
      iconURL: embeddableUrl(user.image, appUrl) ?? undefined,
    })
    .addFields(
      { name: 'Completed', value: String(stats.completed), inline: true },
      { name: 'Tracked', value: String(stats.titlesTracked), inline: true },
      {
        name: 'Mean rating',
        value: stats.meanRating !== null ? stats.meanRating.toFixed(1) : '—',
        inline: true,
      },
      { name: 'Episodes this year', value: String(stats.episodesThisYear), inline: true },
      { name: 'Chapters this year', value: String(stats.chaptersThisYear), inline: true },
      { name: 'Day streak', value: String(stats.dayStreak), inline: true },
    )
    .setFooter({ text: `On Trackt since ${user.joinedAt.slice(0, 4)}` });

  if (user.bio) embed.setDescription(user.bio.slice(0, 4096));

  const favorites = [...profile.favorites]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, FAVORITES_SHOWN)
    .map((favorite) => mediaLink(favorite.title, favorite.slug, appUrl));
  if (favorites.length > 0) {
    embed.addFields({ name: 'Favourites', value: joinWithin(favorites, ' · ') });
  }

  const activity = profile.activity
    .slice(0, ACTIVITY_SHOWN)
    .map((entry) => activityLine(entry, appUrl));
  if (activity.length > 0) {
    embed.addFields({ name: 'Recent', value: joinWithin(activity, '\n') });
  }

  return embed;
}
