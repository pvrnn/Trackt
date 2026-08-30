import { TOPIC_LABELS, formatNewsDate } from '@trackt/client';
import type { NewsArticleSummary } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Cover } from './Cover';
import { KindDot } from './KindDot';
import { Touchable } from './Touchable';
import { layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** One story in the feed: cover, topic, headline, standfirst. */
export function NewsRow({ article }: { article: NewsArticleSummary }) {
  const kind = article.kinds[0];
  return (
    <Touchable href={`/news/${article.slug}`} style={styles.card}>
      {kind ? (
        <Cover
          kind={kind}
          title={article.title}
          coverUrl={article.coverUrl}
          width={72}
          showTitle={false}
        />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={[type.eyebrow, text.pink]}>{TOPIC_LABELS[article.topic]}</Text>
          {kind ? <KindDot kind={kind} /> : null}
          <Text style={[type.eyebrow, text.dim]}>{formatNewsDate(article.publishedAt)}</Text>
        </View>
        <Text style={[type.cardTitle, text.fg]} numberOfLines={3}>
          {article.title}
        </Text>
        {article.dek ? (
          <Text style={[type.bodySm, text.muted]} numberOfLines={3}>
            {article.dek}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  cardBody: {
    flex: 1,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
