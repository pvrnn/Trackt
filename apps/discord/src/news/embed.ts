import { EmbedBuilder } from 'discord.js';
import type { NewsArticleSummary } from '@trackt/shared';
import { KIND_LABELS, TOPIC_LABELS } from '../lib/labels.js';

export const TRACKT_COLOR = 0xe8a33d;

/** Discord only renders images it can fetch itself, so relative or non-https covers are dropped. */
export function isEmbeddableImage(url: string | null): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

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
  if (isEmbeddableImage(article.coverUrl)) embed.setImage(article.coverUrl);
  return embed;
}
