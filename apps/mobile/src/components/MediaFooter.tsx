import { externalProfiles } from '@trackt/client';
import type { MediaDetail, RelatedWork, SearchResult } from '@trackt/shared';
import type { ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassCard } from './GlassCard';
import { SectionTitle } from './Page';
import { Shelf, ShelfItem } from './Shelf';
import { color, gutter, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** Everything under the parts: genres, related works, and the details card. */
export function MediaFooter({ media }: { media: MediaDetail }) {
  const { t } = useTranslation();
  // Same fallback as web: IGDB states a release status where TMDB/AniList have
  // none, and a rented link chain belongs to neither.
  const status =
    media.status?.toUpperCase() ??
    (typeof media.metadata.igdbStatus === 'string'
      ? media.metadata.igdbStatus.toUpperCase()
      : null);
  const external = externalProfiles(media.kind, media.externalIds, media.metadata);
  return (
    <View style={styles.footer}>
      {media.genres.length > 0 ? (
        <View style={gutter}>
          <SectionTitle title={t('media.details.genres')} />
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
        <RelatedShelf title={t('media.relatedTitle')} works={media.relations} />
      ) : media.related.length > 0 ? (
        <RelatedShelf title={t('media.youMightLike')} works={media.related} />
      ) : null}

      <View style={gutter}>
        <SectionTitle title={t('media.details.title')} />
        <GlassCard style={styles.details}>
          <Detail label={t('media.details.status')} value={status ?? '—'} />
          <Detail
            label={t('media.details.released')}
            value={media.releaseDate ?? (media.year !== null ? String(media.year) : '—')}
          />
          {media.synonyms.length > 0 ? (
            <Detail label={t('media.details.alsoKnownAs')} value={media.synonyms.join(' · ')} />
          ) : null}
          <Detail
            label={t('media.details.external')}
            value={
              external.length > 0 ? (
                <View style={styles.external}>
                  {external.map(({ provider, url }) => (
                    <Text
                      key={provider}
                      accessibilityRole={url ? 'link' : undefined}
                      onPress={url ? () => void Linking.openURL(url) : undefined}
                      style={[type.bodySm, url ? text.pink : text.dim]}
                    >
                      {provider.toUpperCase()}
                      {url ? ' ↗' : ''}
                    </Text>
                  ))}
                </View>
              ) : (
                '—'
              )
            }
          />
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

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
      {typeof value === 'string' ? (
        <Text style={[type.bodySm, styles.detailValue]}>{value}</Text>
      ) : (
        value
      )}
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
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
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
  external: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
  },
});
