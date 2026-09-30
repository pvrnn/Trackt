import { EmbedBuilder } from 'discord.js';
import type { NewsArticleSummary } from '@trackt/shared';
import { KIND_LABELS, TOPIC_LABELS } from '../lib/labels.js';
import { embeddableUrl } from '../lib/urls.js';

export const TRACKT_COLOR = 0xe8a33d;

export function newsEmbed(article: NewsArticleSummary, appUrl: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(TRACKT_COLOR)
    .setTitle(article.title.slice(0, 256))
    .setURL(new URL(`/news/${encodeURIComponent(article.slug)}`, appUrl).toString())
    .setTimestamp(new Date(article.publishedAt))
    .setFooter({
      text: [TOPIC_LABELS[article.topic], ...article.kinds.map((kind) => KIND_LABELS[kind])].join(
        ' · ',
      ),
    });
  if (article.dek) embed.setDescription(article.dek);
  const cover = embeddableUrl(article.coverUrl, appUrl);
  if (cover) embed.setImage(cover);
  return embed;
}
