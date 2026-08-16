import { FlashList } from '@shopify/flash-list';
import {
  KIND_LABELS_SINGULAR,
  LOG_STATUS_LABELS,
  dateRangeLabel,
  useMediaDetail,
} from '@trackt/client';
import {
  trackingVerbLabel,
  type MediaDetail,
  type RelatedWork,
  type SearchResult,
} from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import {
  BackLink,
  EmptyState,
  Loading,
  PageFrame,
  SectionTitle,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

const TILE_MIN = 56;

/**
 * The media page (`GET /media/:idOrSlug`) — the screen every other one links to.
 *
 * It is a `FlashList` of part rows rather than a `ScrollView`, because the part
 * grid is the one list in the app with no ceiling: a long-running manga carries
 * hundreds of chapters, and rendering them all into a scroll view is the
 * difference between a screen that opens and one that hangs. The hero, the
 * synopsis and the related shelves ride as the list's header and footer.
 *
 * Phase 2 reads. The parts show what has been checked in; **tapping one does
 * nothing yet** and they are deliberately not styled as buttons — check-in,
 * rating, status and the log dates are phase 3, and a tile that looks tappable
 * and isn't is worse than a tile that doesn't.
 */
export default function MediaScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: media, isPending, isError } = useMediaDetail(slug);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const columns = Math.max(
    4,
    Math.floor((width - layout.gutter * 2 + space.sm) / (TILE_MIN + space.sm)),
  );
  const tileWidth = Math.floor((width - layout.gutter * 2 - space.sm * (columns - 1)) / columns);

  const watched = useMemo(() => new Set(media?.viewer?.watched ?? []), [media?.viewer?.watched]);

  const rows = useMemo(() => {
    const total = media?.partCount ?? 0;
    const out: number[][] = [];
    for (let start = 1; start <= total; start += columns) {
      out.push(Array.from({ length: Math.min(columns, total - start + 1) }, (_, i) => start + i));
    }
    return out;
  }, [media?.partCount, columns]);

  if (isPending) {
    return (
      <PageFrame>
        <View style={[styles.gutter, { paddingTop: insets.top + space.md }]}>
          <BackLink />
        </View>
        <Loading />
      </PageFrame>
    );
  }

  if (isError || !media) {
    return (
      <PageFrame>
        <View style={[styles.gutter, { paddingTop: insets.top + space.md, gap: space.lg }]}>
          <BackLink />
          <EmptyState
            title={media === null ? 'Not found' : "Couldn't load"}
            body={
              media === null
                ? "This instance's catalog has no title at that address."
                : "The instance didn't answer. Go back and try again."
            }
          />
        </View>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <FlashList
        data={rows}
        keyExtractor={(row) => `parts-${row[0]}`}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.md }}>
            <Hero media={media} watched={watched} />
            {rows.length > 0 ? (
              <View style={[styles.gutter, styles.partsHead]}>
                <SectionTitle
                  title={
                    media.kind === 'manga' || media.kind === 'webtoon' ? 'Chapters' : 'Episodes'
                  }
                />
                <Text style={[type.eyebrow, styles.dim]}>
                  {watched.size} OF {media.partCount} {trackingVerbLabel(media.kind).toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={<Footer media={media} />}
        renderItem={({ item }) => (
          <View style={[styles.gutter, styles.partRow]}>
            {item.map((number) => (
              <View
                key={number}
                style={[
                  styles.tile,
                  { width: tileWidth, height: tileWidth },
                  watched.has(number) && styles.tileWatched,
                ]}
              >
                <Text
                  style={[type.eyebrow, watched.has(number) ? styles.tileWatchedText : styles.dim]}
                >
                  {number}
                </Text>
              </View>
            ))}
          </View>
        )}
      />
    </PageFrame>
  );
}

function Hero({ media, watched }: { media: MediaDetail; watched: ReadonlySet<number> }) {
  const viewer = media.viewer;
  const range = viewer ? dateRangeLabel(viewer.startedAt, viewer.finishedAt) : null;
  return (
    <View style={[styles.gutter, styles.hero]}>
      <BackLink />
      <View style={styles.heroRow}>
        <Cover
          kind={media.kind}
          title={media.title}
          coverUrl={media.coverUrl}
          width={120}
          showTitle={false}
        />
        <View style={styles.heroText}>
          <View style={styles.metaRow}>
            <KindDot kind={media.kind} />
            <Text style={[type.eyebrow, styles.dim]}>
              {KIND_LABELS_SINGULAR[media.kind]}
              {media.year ? ` · ${media.year}` : ''}
              {media.seasonNumber ? ` · S${media.seasonNumber}` : ''}
            </Text>
          </View>
          <Text style={[type.title, styles.fg]}>{media.title.toUpperCase()}</Text>
          {media.originalTitle && media.originalTitle !== media.title ? (
            <Text style={[type.bodySm, styles.dim]} numberOfLines={2}>
              {media.originalTitle}
            </Text>
          ) : null}
        </View>
      </View>

      {/* The viewer's own state, read-only until phase 3 wires the mutations. */}
      {viewer ? (
        <View style={styles.pills}>
          {viewer.status ? (
            <Text style={[type.eyebrow, styles.pill]}>{LOG_STATUS_LABELS[viewer.status]}</Text>
          ) : null}
          {viewer.score !== null ? (
            <Text style={[type.eyebrow, styles.pill]}>★ {viewer.score}</Text>
          ) : null}
          {viewer.favorited ? <Text style={[type.eyebrow, styles.pill]}>FAVOURITE</Text> : null}
          {range ? <Text style={[type.eyebrow, styles.pill]}>{range}</Text> : null}
        </View>
      ) : null}

      <View style={styles.stats}>
        {media.community.averageScore !== null ? (
          <Stat
            value={media.community.averageScore.toFixed(1)}
            label={`${media.community.ratingCount} ratings`}
          />
        ) : null}
        {media.partCount ? (
          <Stat value={`${watched.size}/${media.partCount}`} label="Progress" />
        ) : null}
        {media.status ? <Stat value={media.status.toUpperCase()} label="Status" /> : null}
      </View>

      {media.description ? (
        <Text style={[type.body, styles.muted]}>{media.description}</Text>
      ) : null}
    </View>
  );
}

function Footer({ media }: { media: MediaDetail }) {
  return (
    <View style={styles.footer}>
      {media.genres.length > 0 ? (
        <View style={styles.gutter}>
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
        <Shelf title="Related" works={media.relations} />
      ) : media.related.length > 0 ? (
        <Shelf title="You might also like" works={media.related} />
      ) : null}

      <View style={styles.gutter}>
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

function Shelf({ title, works }: { title: string; works: (RelatedWork | SearchResult)[] }) {
  return (
    <View>
      <View style={styles.gutter}>
        <SectionTitle title={title} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelf}
      >
        {works.map((work) => (
          <Touchable key={work.id} href={`/media/${work.slug}`}>
            <Cover kind={work.kind} title={work.title} coverUrl={work.coverUrl} width={96} />
            {'relation' in work ? (
              <Text style={[type.eyebrow, styles.relation]}>{work.relation.toUpperCase()}</Text>
            ) : null}
            <Text style={[type.bodySm, styles.shelfCaption]} numberOfLines={2}>
              {work.title}
            </Text>
          </Touchable>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{value}</PrismText>
      </View>
      <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
      <Text style={[type.bodySm, styles.detailValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: layout.gutter,
  },
  hero: {
    gap: space.lg,
  },
  heroRow: {
    flexDirection: 'row',
    gap: space.lg,
  },
  heroText: {
    flex: 1,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pill: {
    color: color.pink,
    backgroundColor: surface.pinkSelected,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    overflow: 'hidden',
  },
  stats: {
    flexDirection: 'row',
    gap: space.xl,
  },
  stat: {
    gap: space.xs,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  partsHead: {
    marginTop: layout.sectionGap,
  },
  partRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.sm,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.thumb,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  tileWatched: {
    backgroundColor: surface.pinkSelected,
    borderColor: color.pink,
  },
  tileWatchedText: {
    color: color.pink,
  },
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
  shelf: {
    gap: space.md,
    paddingHorizontal: layout.gutter,
  },
  shelfCaption: {
    color: color.fg,
    width: 96,
    marginTop: space.xs,
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
  fg: {
    color: color.fg,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
});
