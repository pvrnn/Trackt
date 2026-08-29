import { useQueryClient } from '@tanstack/react-query';
import {
  LOG_STATUS_LABELS,
  dateRangeLabel,
  firstUnwatched,
  invalidateTracking,
  partBlocks,
  partWindow,
  progressUpTo,
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
import { BlurView } from 'expo-blur';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddToListSheet } from '../../../src/components/AddToListSheet';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { LogDatesSheet } from '../../../src/components/LogDatesSheet';
import { MediaActionRow, RatingCard } from '../../../src/components/MediaActions';
import { MediaHero } from '../../../src/components/MediaHero';
import {
  BackLink,
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  SectionTitle,
  StaleNotice,
} from '../../../src/components/Page';
import { PartBlockRow, PartRow } from '../../../src/components/PartRows';
import { ProgressCard } from '../../../src/components/ProgressCard';
import { RatingSheet } from '../../../src/components/RatingSheet';
import { StatusSheet } from '../../../src/components/StatusSheet';
import { Touchable } from '../../../src/components/Touchable';
import { EMPTY_VIEWER, patchViewer, trackingPatch } from '../../../src/lib/offline';
import type { TrackingWrite } from '../../../src/lib/offline';
import { useViewerMutation } from '../../../src/lib/tracking';
import { color, gutter, layout, radius, space, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/** The collapsed bar `Mobile System.dc.html` fixes for both platforms: 44pt. */
const HEADER_HEIGHT = layout.touchTarget;

/** How far the hero scrolls before the bar is fully opaque. */
const HEADER_FADE = [120, 220] as const;

/** Which sheet is up, if any. One at a time — they are all modal. */
type OpenSheet = 'status' | 'rating' | 'list' | null;

/**
 * The media screen, rebuilt on `docs/design/Mobile Media.dc.html`.
 *
 * The design's argument, and now the screen's: **the counter is the source of
 * truth.** Progress is one integer, not a set of ticked boxes, so one control —
 * the same block, in the same place, on a movie, a season and a 1120-chapter
 * manga — carries it, and everything else is a view onto that integer. Type
 * into the number, drag the slider, tap −/+, or tap a row: all four are the
 * same write (`setProgress`).
 *
 * That is what makes the screen work with the catalog we actually have. Flat
 * numbered parts (ADR-0003) carry no titles, no air dates, no runtimes, and the
 * mockup's own rule is that rows earn their place through *metadata*, not
 * count — "24 untitled chapters still read better as a counter". So the counter
 * always leads here, and the parts below it are:
 *
 * - a work of 40 or fewer: every part, as a row;
 * - anything longer: blocks of 40, each with its own bar, and one opened block
 *   showing a six-row window around where you are.
 *
 * A 1120-chapter manga is 28 rows and a window, never 1120 tiles. That also
 * retires the `FlashList` this screen used to be: with the grid gone nothing
 * here is unbounded, so it is an ordinary scroll view again, and the hero can
 * be a full-bleed panel rather than a list header.
 */
export default function MediaScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: media, dataUpdatedAt, isPending, isError } = useMediaDetail(slug);
  const queryClient = useQueryClient();
  const { apply } = useViewerMutation(slug);
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  // The dates sheet's *initial* value, or null when closed. Held rather than
  // read off `viewer` at open time, so the auto-open after a COMPLETED status
  // change can hand it the dates it just stamped without racing the cache.
  const [editingDates, setEditingDates] = useState<LogDates | null>(null);
  // Which block of parts is expanded, or null for "the one you are in".
  const [openBlock, setOpenBlock] = useState<number | null>(null);

  const viewer = media?.viewer ?? EMPTY_VIEWER;
  const watched = useMemo(() => new Set(viewer.watched), [viewer.watched]);

  // How far the screen has scrolled, for the hero parallax and the header bar.
  const scrollY = useSharedValue(0);

  if (isPending) {
    return (
      <PageFrame>
        <View style={[gutter, { paddingTop: insets.top + space.md, gap: space.lg }]}>
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
        <View style={[gutter, { paddingTop: insets.top + space.md, gap: space.lg }]}>
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
  const hasParts = detail.kind !== 'movie';
  /** Null while a season is airing or a count is unknown — not zero. */
  const total = hasParts ? detail.partCount : null;
  const noun = partNoun(detail);
  /** Where the viewer is: the unbroken run from part 1 (`progressUpTo`). */
  const position = progressUpTo(watched);
  const blocks = total !== null ? partBlocks(total, position) : [];
  const doneWithAll = total !== null && position >= total;

  const setPosition = (upTo: number) => apply({ op: 'setProgress', id: detail.id, upTo });

  const setStatus = (status: LogStatus | null) => {
    const write: TrackingWrite =
      status === null
        ? { op: 'clearStatus', id: detail.id }
        : { op: 'setStatus', id: detail.id, status };
    // The same patch `useViewerMutation` is about to apply, computed here for
    // the one thing the screen does that the cache cannot: open the dates sheet
    // on the pair it just stamped. `trackingPatch` is pure, so asking twice is
    // cheaper than two definitions drifting apart.
    const patch = trackingPatch(write, detail, todayIso());
    apply(write);
    // The one transition with no evidence behind its date: the user is logging
    // something they watched at some unknown time in the past, and today is
    // almost certainly wrong. Every other transition has a check-in or a prior
    // date behind it, and must not interrupt.
    if (status === 'completed' && (viewer.status === null || viewer.status === 'planned')) {
      setEditingDates({ startedAt: patch.startedAt ?? null, finishedAt: patch.finishedAt ?? null });
    }
  };

  /**
   * The primary action, in the design's words: name the next unit and nothing
   * more. A movie has no next unit, so it gets the one step it does have.
   */
  const primary = hasParts
    ? doneWithAll
      ? { label: 'CAUGHT UP', caughtUp: true, onPress: () => setSheet('status') }
      : {
          label: `${trackingVerbLabel(detail.kind, 'present').toUpperCase()} ${noun.prefix}${position + 1}`,
          caughtUp: false,
          onPress: () => setPosition(position + 1),
        }
    : viewer.status === 'completed'
      ? { label: 'WATCHED', caughtUp: true, onPress: () => setSheet('status') }
      : {
          label: 'MARK WATCHED',
          caughtUp: false,
          onPress: () => setStatus('completed'),
        };

  return (
    <PageFrame>
      <Animated.ScrollView
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      >
        <MediaHero
          media={detail}
          scrollY={scrollY}
          statusLabel={viewer.status ? LOG_STATUS_LABELS[viewer.status].toUpperCase() : null}
          dateLabel={dateRangeLabel(viewer.startedAt, viewer.finishedAt)}
          onEditStatus={() => setSheet('status')}
          onEditDates={() => setEditingDates({ ...viewer })}
        />

        <View style={[gutter, styles.body]}>
          <StaleNotice updatedAt={dataUpdatedAt} />

          <MediaActionRow
            label={primary.label}
            caughtUp={primary.caughtUp}
            favorited={viewer.favorited}
            onPrimary={primary.onPress}
            onToggleFavorite={() =>
              apply({ op: viewer.favorited ? 'unfavorite' : 'favorite', id: detail.id })
            }
            onAddToList={() => setSheet('list')}
          />

          <RatingCard
            score={viewer.score}
            communityScore={detail.community.averageScore}
            ratingCount={detail.community.ratingCount}
            onPress={() => setSheet('rating')}
          />

          {hasParts && total !== null ? (
            <ProgressCard
              // Keyed by the position so a value that moves under the control —
              // a queued write landing, a rolled-back patch — resets its drafts
              // instead of being mirrored by an effect.
              key={position}
              unitLabel={`${noun.plural.toUpperCase()} ${trackingVerbLabel(detail.kind).toUpperCase()}`}
              total={total}
              position={position}
              watchedCount={watched.size}
              onCommit={setPosition}
            />
          ) : null}

          {detail.description ? (
            <Text style={[type.body, text.muted]}>{detail.description}</Text>
          ) : null}
        </View>

        {hasParts ? (
          <PartsSection
            detail={detail}
            noun={noun}
            total={total}
            position={position}
            watched={watched}
            blocks={blocks}
            openBlock={openBlock}
            onToggleBlock={(index) => setOpenBlock((current) => (current === index ? null : index))}
            onSetPosition={setPosition}
          />
        ) : null}

        <Footer media={detail} />
      </Animated.ScrollView>

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

/** 'Episode'/'Chapter', its plural, and the short prefix a button uses. */
function partNoun(detail: MediaDetail): { singular: string; plural: string; prefix: string } {
  return detail.kind === 'manga' || detail.kind === 'webtoon'
    ? { singular: 'Chapter', plural: 'Chapters', prefix: 'CH' }
    : { singular: 'Episode', plural: 'Episodes', prefix: 'E' };
}

/**
 * The parts, at whatever scale the work is.
 *
 * Short work: every part, as a row. Long work: blocks of forty, and a six-row
 * window inside the one you open — the design's "never the whole volume, never
 * the whole work". An unknown count (an airing season) has no scale to block
 * up, so it gets the window around the position and nothing else.
 *
 * Every row writes the position: tapping part 140 marks everything to it,
 * tapping a part already done sets the position to one below, which is how an
 * overshoot is corrected without a dialog.
 */
function PartsSection({
  detail,
  noun,
  total,
  position,
  watched,
  blocks,
  openBlock,
  onToggleBlock,
  onSetPosition,
}: {
  detail: MediaDetail;
  noun: { singular: string; plural: string; prefix: string };
  total: number | null;
  position: number;
  watched: ReadonlySet<number>;
  blocks: ReturnType<typeof partBlocks>;
  openBlock: number | null;
  onToggleBlock: (index: number) => void;
  onSetPosition: (upTo: number) => void;
}) {
  const volumes = detail.kind === 'manga' || detail.kind === 'webtoon';
  const next = firstUnwatched(watched, total ?? position + 1);

  const row = (number: number) => (
    <PartRow
      key={number}
      label={`${noun.singular} ${number}`}
      done={watched.has(number)}
      isNext={number === next}
      // Tapping what you have done sets the position below it; tapping ahead
      // brings everything up to it. One write either way.
      onPress={() => onSetPosition(watched.has(number) ? number - 1 : number)}
    />
  );

  if (total === null) {
    // No count yet: no blocks, no percentage — just where you are and what is
    // immediately around it.
    const around = partWindow(1, position + 4, position);
    return (
      <View style={[gutter, styles.parts]}>
        <SectionTitle title={noun.plural} />
        <Text style={[type.eyebrow, text.dim]}>{position} SO FAR · COUNT NOT PUBLISHED YET</Text>
        <View style={styles.rows}>{around.map(row)}</View>
      </View>
    );
  }

  if (blocks.length === 0) {
    return (
      <View style={[gutter, styles.parts]}>
        <SectionTitle title={noun.plural} />
        <View style={styles.rows}>{Array.from({ length: total }, (_, i) => i + 1).map(row)}</View>
      </View>
    );
  }

  // The block you are in is the one that opens, until you say otherwise.
  const current = Math.min(
    blocks.length,
    Math.max(1, Math.ceil(Math.max(position, 1) / blocks[0]!.size)),
  );
  const activeIndex = openBlock ?? current;
  const active = blocks.find((block) => block.index === activeIndex) ?? blocks[0]!;
  const window = partWindow(active.from, active.to, position);
  const inside = position >= active.from && position <= active.to;

  return (
    <View style={[gutter, styles.parts]}>
      <View style={styles.partsHead}>
        <SectionTitle title={volumes ? 'Volumes' : noun.plural} />
        <Text style={[type.eyebrow, text.dim]}>
          {blocks.length} {volumes ? 'VOLUMES' : 'BLOCKS'} · {total} {noun.plural.toUpperCase()}
        </Text>
      </View>

      <View style={styles.rows}>
        {blocks.map((block) => (
          <PartBlockRow
            key={block.index}
            block={block}
            label={volumes ? `Volume ${block.index}` : `${noun.plural} ${block.from}–${block.to}`}
            rangeLabel={
              volumes
                ? `${noun.prefix} ${block.from}–${block.to}`
                : `${block.size} ${noun.plural.toUpperCase()}`
            }
            open={block.index === activeIndex}
            onPress={() => onToggleBlock(block.index)}
          />
        ))}
      </View>

      <View style={styles.windowHead}>
        <Text style={[type.section, text.fg]}>
          {(volumes
            ? `Volume ${active.index}`
            : `${noun.plural} ${active.from}–${active.to}`
          ).toUpperCase()}
          {inside ? ' · AROUND YOU' : ''}
        </Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.rows}>{window.map(row)}</View>
      <Text style={[type.eyebrow, text.faint]}>
        OPEN A {volumes ? 'VOLUME' : 'BLOCK'} TO JUMP THERE · THE SLIDER TRAVELS FURTHER
      </Text>
    </View>
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

  // Over the hero art the back link needs its own ink to sit on (the mockup's
  // floating pill); once the bar's own glass has arrived it would be a second
  // surface on top of a surface, so it fades out as that fades in.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...HEADER_FADE], [1, 0], 'clamp'),
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
        {/* The blur alone is not enough: §05 forbids content behind fighting
            the text. Same 82% ink the tab bar puts over its own blur. */}
        <View style={[StyleSheet.absoluteFill, styles.headerFill]} />
        <View style={styles.headerRule} />
      </Animated.View>
      <View style={styles.headerRow}>
        <View>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.backPill, pillStyle]}
            pointerEvents="none"
          />
          <BackLink />
        </View>
        <Animated.Text numberOfLines={1} style={[type.section, styles.headerTitle, glassStyle]}>
          {title.toUpperCase()}
        </Animated.Text>
      </View>
    </View>
  );
}

function Footer({ media }: { media: MediaDetail }) {
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
        <Shelf title="Related" works={media.relations} />
      ) : media.related.length > 0 ? (
        <Shelf title="You might also like" works={media.related} />
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

function Shelf({ title, works }: { title: string; works: (RelatedWork | SearchResult)[] }) {
  return (
    <View>
      <View style={gutter}>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
      <Text style={[type.bodySm, styles.detailValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
    paddingTop: space.lg,
  },
  parts: {
    gap: space.md,
    marginTop: layout.sectionGap,
  },
  partsHead: {
    gap: space.xs,
  },
  rows: {
    gap: space.sm,
  },
  windowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: surface.glassBorder,
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
  backPill: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14,12,16,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    marginVertical: space.xs,
    marginHorizontal: -space.sm,
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
});
