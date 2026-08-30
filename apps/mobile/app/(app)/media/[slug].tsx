import { useQueryClient } from '@tanstack/react-query';
import {
  LOG_STATUS_LABELS,
  dateRangeLabel,
  invalidateTracking,
  partBlocks,
  progressUpTo,
  todayIso,
  trackingApi,
  useMediaDetail,
} from '@trackt/client';
import { trackingVerbLabel, type LogDates, type LogStatus, type MediaDetail } from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddToListSheet } from '../../../src/components/AddToListSheet';
import { CollapsingHeader } from '../../../src/components/CollapsingHeader';
import { LogDatesSheet } from '../../../src/components/LogDatesSheet';
import { MediaActionRow, RatingCard } from '../../../src/components/MediaActions';
import { MediaFooter } from '../../../src/components/MediaFooter';
import { MediaHero } from '../../../src/components/MediaHero';
import { PageFrame, ScreenState, StaleNotice } from '../../../src/components/Page';
import { PartsSection, partNoun } from '../../../src/components/PartsSection';
import { ProgressCard } from '../../../src/components/ProgressCard';
import { RatingSheet } from '../../../src/components/RatingSheet';
import { StatusSheet } from '../../../src/components/StatusSheet';
import { EMPTY_VIEWER, patchViewer, trackingPatch } from '../../../src/lib/offline';
import type { TrackingWrite } from '../../../src/lib/offline';
import { useViewerMutation } from '../../../src/lib/tracking';
import { gutter, space, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/** Which sheet is up, if any. One at a time — they are all modal. */
type OpenSheet = 'status' | 'rating' | 'list' | null;

/**
 * The media screen (`docs/design/Mobile Media.dc.html`).
 *
 * The counter is the source of truth: progress is one integer, not a set of
 * ticked boxes, so typing the number, dragging the slider, tapping −/+ and
 * tapping a row are all the same write (`setProgress`). Nothing on the screen
 * is unbounded, which is why it is an ordinary scroll view rather than a list.
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

  if (isPending || isError || !media) {
    return (
      <ScreenState
        isPending={isPending}
        title={media === null ? 'Not found' : "Couldn't load"}
        body={
          media === null
            ? "This instance's catalog has no title at that address."
            : "The instance didn't answer. Go back and try again."
        }
      />
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

        <MediaFooter media={detail} />
      </Animated.ScrollView>

      <CollapsingHeader title={detail.title} scrollY={scrollY} />

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

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
    paddingTop: space.lg,
  },
});
