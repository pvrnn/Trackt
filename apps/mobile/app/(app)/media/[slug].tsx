import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import {
  KIND_LABELS_SINGULAR,
  LOG_STATUS_LABELS,
  dateRangeLabel,
  firstUnwatched,
  invalidateTracking,
  progressUpTo,
  todayIso,
  trackingApi,
  useMediaDetail,
  usesProgressSlider,
} from '@trackt/client';
import {
  trackingVerbLabel,
  type LogDates,
  type LogStatus,
  type MediaDetail,
  type RelatedWork,
  type SearchResult,
} from '@trackt/shared';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddToListSheet } from '../../../src/components/AddToListSheet';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { Icon, type IconName } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import { LogDatesSheet } from '../../../src/components/LogDatesSheet';
import { PartProgress } from '../../../src/components/PartProgress';
import {
  BackLink,
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  SectionTitle,
  StaleNotice,
} from '../../../src/components/Page';
import { AnimatedPressable, ripple, usePressMotion } from '../../../src/components/Press';
import { PrismButton } from '../../../src/components/PrismButton';
import { PrismText } from '../../../src/components/PrismText';
import { RatingSheet } from '../../../src/components/RatingSheet';
import { StatusSheet } from '../../../src/components/StatusSheet';
import { Touchable } from '../../../src/components/Touchable';
import { duration, staggerDelay } from '../../../src/lib/motion';
import {
  EMPTY_VIEWER,
  patchViewer,
  trackingPatch,
  type TrackingWrite,
} from '../../../src/lib/offline';
import { useViewerMutation } from '../../../src/lib/tracking';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

const TILE_MIN = 56;

/** The collapsed bar `Mobile System.dc.html` fixes for both platforms: 44pt. */
const HEADER_HEIGHT = layout.touchTarget;

/** How far the hero scrolls before the bar is fully opaque. */
const HEADER_FADE = [80, 150] as const;

/** One frozen empty page of rows: a fresh `[]` per render re-keys the list. */
const EMPTY_ROWS: number[][] = [];

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
  const { data: media, dataUpdatedAt, isPending, isError } = useMediaDetail(slug);
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

  // How far the list has scrolled, for the hero parallax and the header bar.
  // Written from a plain `onScroll` rather than `useAnimatedScrollHandler`:
  // `FlashList` invokes the `onScroll` prop as an ordinary JS callback, so a
  // worklet handler passed to it would never be recognised as one. Only the
  // *input* crosses the bridge — everything derived from it runs on the UI
  // thread, which is what keeps the parallax off the JS frame budget.
  const scrollY = useSharedValue(0);

  // A status change can flip every tile in the grid at once (COMPLETED sweeps
  // progress, PLANNED clears it); a tap flips one. Only the first staggers, and
  // the screen is told which it is by the handler that caused it rather than
  // inferring it from the count — the write is where that is known for certain.
  const [sweeping, setSweeping] = useState(false);

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
        <View style={[styles.gutter, { paddingTop: insets.top + space.md, gap: space.lg }]}>
          <BackLink />
          <OfflineFallback>
            <Loading />
          </OfflineFallback>
        </View>
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

  /** Past 30 parts the grid is a wall, so the position leads instead. */
  const longWork = checkable && usesProgressSlider(total);
  /** The highest part with everything before it seen — what a position means. */
  const position = progressUpTo(watched);
  // A long work gets the position and nothing else: hundreds of tiles is the
  // wall this replaced, and offering it anyway just moves the wall down a fold.
  const showGrid = !longWork;

  const togglePart = (number: number) => {
    setSweeping(false);
    apply(
      watched.has(number)
        ? { op: 'uncheck', id: detail.id, part: number }
        : { op: 'checkIn', id: detail.id, part: number },
    );
  };

  const setPosition = (upTo: number) => {
    setSweeping(false);
    apply({ op: 'setProgress', id: detail.id, upTo });
  };

  const setStatus = (status: LogStatus | null) => {
    const write: TrackingWrite =
      status === null
        ? { op: 'clearStatus', id: detail.id }
        : { op: 'setStatus', id: detail.id, status };
    // The same patch `useViewerMutation` is about to apply, computed here for
    // the two things the screen does that the cache cannot: stagger the grid
    // when a status change sweeps it (PRD §3.1), and open the dates sheet on
    // the stamped pair. Derived, never re-derived — `trackingPatch` is pure, so
    // asking twice is cheaper than two definitions drifting apart.
    const patch = trackingPatch(write, detail, todayIso());
    setSweeping('watched' in patch);
    apply(write);
    // The one transition with no evidence behind its date: the user is logging
    // something they watched at some unknown time in the past, and today is
    // almost certainly wrong. Every other transition has a check-in or a prior
    // date behind it, and must not interrupt.
    if (status === 'completed' && (viewer.status === null || viewer.status === 'planned')) {
      setEditingDates({ startedAt: patch.startedAt ?? null, finishedAt: patch.finishedAt ?? null });
    }
  };

  return (
    <PageFrame>
      <FlashList
        data={showGrid ? rows : EMPTY_ROWS}
        keyExtractor={(row) => `parts-${row[0]}`}
        extraData={`${watched.size}-${sweeping}-${showGrid}`}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + HEADER_HEIGHT }}>
            <Hero
              scrollY={scrollY}
              media={detail}
              watched={watched}
              next={next}
              onCheckInNext={() => {
                if (next !== null) togglePart(next);
              }}
              onOpen={setSheet}
              onEditDates={() => setEditingDates({ ...viewer })}
              onToggleFavorite={() =>
                apply({ op: viewer.favorited ? 'unfavorite' : 'favorite', id: detail.id })
              }
            />
            <View style={styles.gutter}>
              <StaleNotice updatedAt={dataUpdatedAt} />
            </View>
            {rows.length > 0 ? (
              <View style={[styles.gutter, styles.partsHead]}>
                <SectionTitle
                  title={
                    detail.kind === 'manga' || detail.kind === 'webtoon' ? 'Chapters' : 'Episodes'
                  }
                />
                {longWork && total !== null ? (
                  <PartProgress
                    // Keyed by the position so a value that moves under the
                    // control — a queued write landing, a rolled-back patch —
                    // resets its drafts instead of being mirrored by an effect.
                    key={position}
                    noun={partNoun(detail).singular}
                    total={total}
                    position={position}
                    watchedCount={watched.size}
                    doneLabel={trackingVerbLabel(detail.kind)}
                    onCommit={setPosition}
                  />
                ) : (
                  <Text style={[type.eyebrow, styles.dim]}>
                    {watched.size} OF {detail.partCount}{' '}
                    {trackingVerbLabel(detail.kind).toUpperCase()}
                  </Text>
                )}
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
                staggered={sweeping}
                noun={partNoun(detail)}
                onPress={() => togglePart(number)}
              />
            ))}
          </View>
        )}
      />

      <HeaderBar title={detail.title} scrollY={scrollY} />

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
            apply(
              score === null
                ? { op: 'clearScore', id: detail.id }
                : { op: 'setScore', id: detail.id, score },
            )
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
 * From phase 4 the fill is animated rather than switched. Two things make that
 * more than decoration. A single tap gets a 140ms fade, which is what tells the
 * eye *which* tile it just hit in a grid of sixty identical squares. And when a
 * status change sweeps the whole grid — COMPLETED marks every part at once —
 * the tiles land in sequence (`staggered`), so the sweep reads as one action
 * the user caused rather than as the screen having been replaced.
 *
 * The stagger is suppressed for a single toggle, because a chapter 240 tile
 * would otherwise wait a quarter second to acknowledge its own tap. And when
 * `number` changes the fill *snaps*: this tile is a recycled `FlashList` cell
 * that has just become a different part, and animating that would flash a fill
 * across the grid on every scroll.
 *
 * The label carries what the bare number can't: the tile shows `13`, the screen
 * reader hears "Episode 13, watched".
 */
function PartTile({
  number,
  size,
  watched,
  isNext,
  staggered,
  noun,
  onPress,
}: {
  number: number;
  size: number;
  watched: boolean;
  isNext: boolean;
  /** True when this change is part of a bulk sweep, not a single tap. */
  staggered: boolean;
  noun: { singular: string; prefix: string };
  onPress: () => void;
}) {
  const press = usePressMotion();
  const fill = useSharedValue(watched ? 1 : 0);
  const recycledAs = useRef(number);

  useEffect(() => {
    const target = watched ? 1 : 0;
    if (recycledAs.current !== number) {
      recycledAs.current = number;
      fill.value = target;
      return;
    }
    fill.value = withDelay(
      staggered ? staggerDelay(number - 1, 6) : 0,
      withTiming(target, { duration: duration.micro }),
    );
  }, [watched, number, staggered, fill]);

  // Watched is a *solid* pink tile with dark text, the way web's grid draws it
  // (`bg-pink text-on-prism`). It used to be an 18% pink wash next to up-next's
  // 12% one, with pink text on both — two states six percent apart, which on a
  // phone in daylight is no difference at all. Filled means done; outlined
  // means next.
  const fillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fill.value,
      [0, 1],
      [isNext ? surface.pinkRow : surface.glass, color.pink],
    ),
    borderColor: interpolateColor(
      fill.value,
      [0, 1],
      [isNext ? color.pink : surface.glassBorder, color.pink],
    ),
  }));

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fill.value, [0, 1], [isNext ? color.pink : color.dim, color.onPrism]),
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: watched }}
      accessibilityLabel={`${noun.singular} ${number}${watched ? ' — watched' : isNext ? ' — up next' : ''}`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple()}
      style={[styles.tile, { width: size, height: size }, fillStyle, press.animatedStyle]}
    >
      <Animated.Text style={[type.eyebrow, textStyle]}>{number}</Animated.Text>
    </AnimatedPressable>
  );
}

/**
 * The 44pt bar the page header collapses into (`Mobile System.dc.html`,
 * platform table: "collapses to a 44pt glass bar on scroll" on iOS, the small
 * app bar on Android — the same geometry either way).
 *
 * The back chevron does **not** fade: it is the screen's only in-app way out on
 * iOS, and an affordance that appears only once you have scrolled past it is
 * worse than no affordance. Only the glass and the title cross-fade in, and
 * they do it from the *hero* title's position, so what the bar shows is the
 * thing that just left rather than a new label.
 */
function HeaderBar({ title, scrollY }: { title: string; scrollY: SharedValue<number> }) {
  const insets = useSafeAreaInsets();

  const glassStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...HEADER_FADE], [0, 1], 'clamp'),
  }));

  return (
    <View
      style={[styles.headerBar, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, glassStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
        {/* The blur alone is not enough. The part grid scrolling underneath
            stays legible through it, and "CHAPTERS · 65 OF 180" sliding across
            "‹ BACK" and the title is the exact thing §05 forbids of a sheet —
            content behind fighting the text. Same 82% ink the tab bar puts over
            its own blur. */}
        <View style={[StyleSheet.absoluteFill, styles.headerFill]} />
        <View style={styles.headerRule} />
      </Animated.View>
      <View style={styles.headerRow}>
        <BackLink />
        <Animated.Text numberOfLines={1} style={[type.section, styles.headerTitle, glassStyle]}>
          {title.toUpperCase()}
        </Animated.Text>
      </View>
    </View>
  );
}

function Hero({
  media,
  scrollY,
  watched,
  next,
  onCheckInNext,
  onOpen,
  onEditDates,
  onToggleFavorite,
}: {
  media: MediaDetail;
  scrollY: SharedValue<number>;
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

  // The cover holds back at a third of the scroll and fades as the bar takes
  // over, so the two halves of the header hand off to each other instead of
  // both being on screen at once. Pulling *down* scales it up rather than
  // leaving a gap — the one place in the app where overscroll is not just slack.
  const coverStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [0, 300], [0, 100], 'clamp') },
      { scale: scrollY.value < 0 ? 1 + Math.min(-scrollY.value, 120) / 600 : 1 },
    ],
    opacity: interpolate(scrollY.value, [...HEADER_FADE], [1, 0.25], 'clamp'),
  }));

  return (
    <View style={[styles.gutter, styles.hero]}>
      <View style={styles.heroRow}>
        <Animated.View style={coverStyle}>
          <Cover
            kind={media.kind}
            title={media.title}
            coverUrl={media.coverUrl}
            width={120}
            showTitle={false}
          />
        </Animated.View>
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
          icon="check"
          label={`${trackingVerbLabel(media.kind, 'present')} ${noun.prefix}${next}`}
          onPress={onCheckInNext}
          style={styles.checkIn}
        />
      ) : null}

      <View style={styles.pills}>
        <ActionPill
          label={viewer.status ? LOG_STATUS_LABELS[viewer.status] : 'LOG'}
          {...(viewer.status ? {} : { icon: 'plus' as const })}
          selected={viewer.status !== null}
          onPress={() => onOpen('status')}
          accessibilityLabel={`Status: ${viewer.status ? LOG_STATUS_LABELS[viewer.status] : 'not logged'}`}
        />
        {/* The dates live on the log row, so there is nothing to edit before
            one exists — the same rule web applies. */}
        {viewer.status !== null ? (
          <ActionPill
            label={range ?? 'DATES'}
            {...(range ? {} : { icon: 'plus' as const })}
            selected={range !== null}
            onPress={onEditDates}
            accessibilityLabel={`Dates: ${range ?? 'none set'}`}
          />
        ) : null}
        <ActionPill
          label={viewer.score !== null ? viewer.score.toFixed(1) : 'RATE'}
          {...(viewer.score !== null ? { icon: 'star-filled' as const } : {})}
          selected={viewer.score !== null}
          onPress={() => onOpen('rating')}
          accessibilityLabel={`Your rating: ${viewer.score !== null ? viewer.score.toFixed(1) : 'none'}`}
        />
        <ActionPill
          label="FAVOURITE"
          icon={viewer.favorited ? 'heart-filled' : 'heart'}
          selected={viewer.favorited}
          onPress={onToggleFavorite}
        />
        <ActionPill label="LIST" icon="plus" onPress={() => onOpen('list')} />
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
  icon,
  selected = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple()}
      style={[styles.pill, selected ? styles.pillSelected : null, press.animatedStyle]}
    >
      {icon ? <Icon name={icon} color={selected ? color.pink : color.fg} size={16} /> : null}
      <Text style={[type.button, selected ? styles.pinkText : styles.fg]}>
        {label.toUpperCase()}
      </Text>
    </AnimatedPressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
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
  headerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  headerFill: {
    backgroundColor: 'rgba(14,12,16,0.82)',
  },
  headerRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: surface.glassBorder,
  },
  headerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
  },
  headerTitle: {
    flex: 1,
    color: color.fg,
  },
  partsHead: {
    marginTop: layout.sectionGap,
    gap: space.md,
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
