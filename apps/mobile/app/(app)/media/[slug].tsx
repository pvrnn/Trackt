import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import {
  KIND_LABELS_SINGULAR,
  LOG_STATUS_LABELS,
  dateRangeLabel,
  firstUnwatched,
  invalidateTracking,
  stampedDates,
  todayIso,
  trackingApi,
  useMediaDetail,
} from '@trackt/client';
import {
  trackingVerbLabel,
  type LogDates,
  type LogStatus,
  type MediaDetail,
  type RelatedWork,
  type SearchResult,
} from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddToListSheet } from '../../../src/components/AddToListSheet';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import { LogDatesSheet } from '../../../src/components/LogDatesSheet';
import {
  BackLink,
  EmptyState,
  Loading,
  PageFrame,
  SectionTitle,
} from '../../../src/components/Page';
import { PrismButton } from '../../../src/components/PrismButton';
import { PrismText } from '../../../src/components/PrismText';
import { RatingSheet } from '../../../src/components/RatingSheet';
import { StatusSheet } from '../../../src/components/StatusSheet';
import { Touchable } from '../../../src/components/Touchable';
import { EMPTY_VIEWER, patchViewer, useViewerMutation } from '../../../src/lib/tracking';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

const TILE_MIN = 56;

/** Which sheet is up, if any. One at a time — they are all modal. */
type OpenSheet = 'status' | 'rating' | 'list' | null;

/**
 * The media page (`GET /media/:idOrSlug`) — the screen every other one links to,
 * and from phase 3 the screen where most of the writing happens.
 *
 * It is a `FlashList` of part rows rather than a `ScrollView`, because the part
 * grid is the one list in the app with no ceiling: a long-running manga carries
 * hundreds of chapters, and rendering them all into a scroll view is the
 * difference between a screen that opens and one that hangs. The hero, the
 * synopsis and the related shelves ride as the list's header and footer.
 *
 * Every write is optimistic (`useViewerMutation`): the tile fills, the pill
 * changes, and a failure rolls the cache back and says so in a toast. The four
 * sheets are mounted only while open.
 */
export default function MediaScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: media, isPending, isError } = useMediaDetail(slug);
  const queryClient = useQueryClient();
  const { apply } = useViewerMutation(slug);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  // The dates sheet's *initial* value, or null when closed. Held rather than
  // read off `viewer` at open time, so the auto-open after a COMPLETED status
  // change can hand it the dates it just stamped without racing the cache.
  const [editingDates, setEditingDates] = useState<LogDates | null>(null);

  const columns = Math.max(
    4,
    Math.floor((width - layout.gutter * 2 + space.sm) / (TILE_MIN + space.sm)),
  );
  const tileWidth = Math.floor((width - layout.gutter * 2 - space.sm * (columns - 1)) / columns);

  const viewer = media?.viewer ?? EMPTY_VIEWER;
  const watched = useMemo(() => new Set(viewer.watched), [viewer.watched]);

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

  const detail = media;
  /** Movies track in one step; every other kind counts parts (ADR-0003). */
  const checkable = detail.kind !== 'movie';
  /** Null while a season is airing or a count is unknown — not zero. */
  const total = checkable ? detail.partCount : null;
  /** What the checklist covers: the count, or one past the highest check-in. */
  const listLength = total ?? (viewer.watched.length > 0 ? Math.max(...viewer.watched) : 0);
  // Candidates stop at the known part count — never offer "CHECK IN E13" on a
  // 12-episode series, which the server would reject. Only an unknown total may
  // extend one past the highest watched part.
  const next = checkable ? firstUnwatched(watched, total ?? listLength + 1) : null;

  const togglePart = (number: number) => {
    const isWatched = watched.has(number);
    apply(
      {
        watched: isWatched
          ? viewer.watched.filter((n) => n !== number)
          : [...viewer.watched, number],
      },
      () =>
        isWatched ? trackingApi.uncheck(detail.id, number) : trackingApi.checkIn(detail.id, number),
    );
  };

  const setStatus = (status: LogStatus | null) => {
    if (status === null) {
      apply({ status: null, startedAt: null, finishedAt: null }, () =>
        trackingApi.clearStatus(detail.id),
      );
      return;
    }
    // The API sweeps progress for these two (PRD §3.1); mirror it optimistically
    // so the grid doesn't lag a refetch behind.
    const sweep =
      !checkable || listLength === 0
        ? {}
        : status === 'completed'
          ? { watched: Array.from({ length: listLength }, (_, i) => i + 1) }
          : status === 'planned'
            ? { watched: [] }
            : {};
    const dates = stampedDates(status, viewer, todayIso());
    apply({ status, ...sweep, ...dates }, () => trackingApi.setStatus(detail.id, status));
    // The one transition with no evidence behind its date: the user is logging
    // something they watched at some unknown time in the past, and today is
    // almost certainly wrong. Every other transition has a check-in or a prior
    // date behind it, and must not interrupt.
    if (status === 'completed' && (viewer.status === null || viewer.status === 'planned')) {
      setEditingDates(dates);
    }
  };

  return (
    <PageFrame>
      <FlashList
        data={rows}
        keyExtractor={(row) => `parts-${row[0]}`}
        extraData={watched}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.md }}>
            <Hero
              media={detail}
              watched={watched}
              next={next}
              onCheckInNext={() => {
                if (next !== null) togglePart(next);
              }}
              onOpen={setSheet}
              onEditDates={() => setEditingDates({ ...viewer })}
              onToggleFavorite={() =>
                apply({ favorited: !viewer.favorited }, () =>
                  viewer.favorited
                    ? trackingApi.unfavorite(detail.id)
                    : trackingApi.favorite(detail.id),
                )
              }
            />
            {rows.length > 0 ? (
              <View style={[styles.gutter, styles.partsHead]}>
                <SectionTitle
                  title={
                    detail.kind === 'manga' || detail.kind === 'webtoon' ? 'Chapters' : 'Episodes'
                  }
                />
                <Text style={[type.eyebrow, styles.dim]}>
                  {watched.size} OF {detail.partCount}{' '}
                  {trackingVerbLabel(detail.kind).toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={<Footer media={detail} />}
        renderItem={({ item }) => (
          <View style={[styles.gutter, styles.partRow]}>
            {item.map((number) => (
              <PartTile
                key={number}
                number={number}
                size={tileWidth}
                watched={watched.has(number)}
                isNext={number === next}
                noun={partNoun(detail)}
                onPress={() => togglePart(number)}
              />
            ))}
          </View>
        )}
      />

      {sheet === 'status' ? (
        <StatusSheet
          current={viewer.status}
          mediaTitle={detail.title}
          onPick={setStatus}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'rating' ? (
        <RatingSheet
          score={viewer.score}
          mediaTitle={detail.title}
          onSave={(score) =>
            score === null
              ? apply({ score: null }, () => trackingApi.clearScore(detail.id))
              : apply({ score }, () => trackingApi.setScore(detail.id, score))
          }
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'list' ? (
        <AddToListSheet
          mediaId={detail.id}
          mediaTitle={detail.title}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {editingDates ? (
        <LogDatesSheet
          dates={editingDates}
          mediaTitle={detail.title}
          onClose={() => setEditingDates(null)}
          // Awaited, so the sheet can show the server's 400 rather than closing
          // over a rejected write — hence the direct call instead of `apply`.
          onSave={async (nextDates) => {
            const saved = await trackingApi.setDates(detail.id, nextDates);
            queryClient.setQueryData<MediaDetail | null>(['media', slug], (current) =>
              patchViewer(current, saved),
            );
            await invalidateTracking(queryClient);
          }}
        />
      ) : null}
    </PageFrame>
  );
}

/** 'Episode'/'Chapter' and its short prefix, or null for a movie (ADR-0003). */
function partNoun(detail: MediaDetail): { singular: string; prefix: string } {
  return detail.kind === 'manga' || detail.kind === 'webtoon'
    ? { singular: 'Chapter', prefix: 'CH' }
    : { singular: 'Episode', prefix: 'E' };
}

/**
 * One part in the grid — and, from phase 3, a real button: tap to check in, tap
 * again to undo. The up-next part is outlined pink before it is filled, which
 * is what makes "where was I" answerable at a glance.
 *
 * The label carries what the bare number can't: the tile shows `13`, the screen
 * reader hears "Episode 13, watched".
 */
function PartTile({
  number,
  size,
  watched,
  isNext,
  noun,
  onPress,
}: {
  number: number;
  size: number;
  watched: boolean;
  isNext: boolean;
  noun: { singular: string; prefix: string };
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: watched }}
      accessibilityLabel={`${noun.singular} ${number}${watched ? ' — watched' : isNext ? ' — up next' : ''}`}
      onPress={onPress}
      android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
      style={({ pressed }) => [
        styles.tile,
        { width: size, height: size },
        watched ? styles.tileWatched : isNext ? styles.tileNext : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.eyebrow, watched || isNext ? styles.tileWatchedText : styles.dim]}>
        {number}
      </Text>
    </Pressable>
  );
}

function Hero({
  media,
  watched,
  next,
  onCheckInNext,
  onOpen,
  onEditDates,
  onToggleFavorite,
}: {
  media: MediaDetail;
  watched: ReadonlySet<number>;
  next: number | null;
  onCheckInNext: () => void;
  onOpen: (sheet: OpenSheet) => void;
  onEditDates: () => void;
  onToggleFavorite: () => void;
}) {
  const viewer = media.viewer ?? EMPTY_VIEWER;
  const range = dateRangeLabel(viewer.startedAt, viewer.finishedAt);
  const noun = partNoun(media);

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

      {/* The daily action, in the top third of the screen where the design puts
          it (§00). One tap, no confirmation — the grid below is the undo. */}
      {next !== null ? (
        <PrismButton
          label={`✓ ${trackingVerbLabel(media.kind, 'present')} ${noun.prefix}${next}`}
          onPress={onCheckInNext}
          style={styles.checkIn}
        />
      ) : null}

      <View style={styles.pills}>
        <ActionPill
          label={viewer.status ? LOG_STATUS_LABELS[viewer.status] : '＋ LOG'}
          selected={viewer.status !== null}
          onPress={() => onOpen('status')}
          accessibilityLabel={`Status: ${viewer.status ? LOG_STATUS_LABELS[viewer.status] : 'not logged'}`}
        />
        {/* The dates live on the log row, so there is nothing to edit before
            one exists — the same rule web applies. */}
        {viewer.status !== null ? (
          <ActionPill
            label={range ?? '＋ DATES'}
            selected={range !== null}
            onPress={onEditDates}
            accessibilityLabel={`Dates: ${range ?? 'none set'}`}
          />
        ) : null}
        <ActionPill
          label={viewer.score !== null ? `★ ${viewer.score.toFixed(1)}` : 'RATE'}
          selected={viewer.score !== null}
          onPress={() => onOpen('rating')}
          accessibilityLabel={`Your rating: ${viewer.score !== null ? viewer.score.toFixed(1) : 'none'}`}
        />
        <ActionPill
          label={viewer.favorited ? '♥ FAVOURITE' : '♡ FAVOURITE'}
          selected={viewer.favorited}
          onPress={onToggleFavorite}
        />
        <ActionPill label="＋ LIST" onPress={() => onOpen('list')} />
      </View>

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

/** A glass pill that opens a sheet or toggles a flag; pink once it holds a value. */
function ActionPill({
  label,
  selected = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      onPress={onPress}
      android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
      style={({ pressed }) => [
        styles.pill,
        selected ? styles.pillSelected : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.button, selected ? styles.pinkText : styles.fg]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
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
  checkIn: {
    alignSelf: 'flex-start',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pill: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
    paddingHorizontal: space.lg,
  },
  pillSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
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
  /** Up next: outlined, not filled — it is the target, not a result. */
  tileNext: {
    borderColor: color.pink,
    backgroundColor: surface.pinkRow,
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
  pinkText: {
    color: color.pink,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
});
