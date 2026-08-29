import type { MediaDetail, RelatedWork, SearchResult } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from './GlassCard';
import { SectionTitle } from './Page';
import { Shelf, ShelfItem } from './Shelf';
import { color, gutter, layout, radius, space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** Everything under the parts: genres, related works, and the details card. */
export function MediaFooter({ media }: { media: MediaDetail }) {
  return (
    <View style={styles.footer}>
      {media.genres.length > 0 ? (
        <View style={gutter}>
          <SectionTitle title="Genres" />
          <View style={styles.genres}>
            {media.genres.map((genre) => (
              <Text key={genre} style={[type.eyebrow, styles.genre]}>
                {genre.toUpperCase()}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {media.relations.length > 0 ? (
        <RelatedShelf title="Related" works={media.relations} />
      ) : media.related.length > 0 ? (
        <RelatedShelf title="You might also like" works={media.related} />
      ) : null}

      <View style={gutter}>
        <SectionTitle title="Details" />
        <GlassCard style={styles.details}>
          <Detail label="Released" value={media.releaseDate ?? '—'} />
          <Detail label="Source" value={media.source.toUpperCase()} />
          {media.synonyms.length > 0 ? (
            <Detail label="Also known as" value={media.synonyms.join(' · ')} />
          ) : null}
        </GlassCard>
      </View>
    </View>
  );
}

function RelatedShelf({ title, works }: { title: string; works: (RelatedWork | SearchResult)[] }) {
  return (
    <View>
      <View style={gutter}>
        <SectionTitle title={title} />
      </View>
      <Shelf padding="gutter">
        {works.map((work) => (
          <ShelfItem
            key={work.id}
            href={`/media/${work.slug}`}
            kind={work.kind}
            title={work.title}
            coverUrl={work.coverUrl}
            captionLines={2}
          >
            {'relation' in work ? (
              <Text style={[type.eyebrow, styles.relation]}>{work.relation.toUpperCase()}</Text>
            ) : null}
          </ShelfItem>
        ))}
      </Shelf>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
      <Text style={[type.bodySm, styles.detailValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: layout.sectionGap,
    marginTop: layout.sectionGap,
  },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  genre: {
    color: color.dim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    overflow: 'hidden',
  },
  relation: {
    color: color.pink,
    marginTop: space.sm,
  },
  details: {
    padding: space.lg,
    gap: space.md,
  },
  detailRow: {
    gap: space.xs,
  },
  detailValue: {
    color: color.fg,
  },
});
