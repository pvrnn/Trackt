import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KIND_LABELS_SINGULAR,
  activityVerbLabel,
  invalidateTracking,
  relativeTime,
  trackingApi,
  upNextPartKey,
  useHomeSummary,
} from '@trackt/client';
import {
  IN_PROGRESS_LIMIT,
  trackingVerbLabel,
  type ActivityEntry,
  type UpNextEntry,
} from '@trackt/shared';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  PageFrame,
  PageTitle,
  SectionTitle,
  useTabContentInset,
} from '../../../src/components/Page';
import { AnimatedPressable, ripple, usePressMotion } from '../../../src/components/Press';
import { SkeletonRows } from '../../../src/components/Skeleton';
import { SwipeCheckIn } from '../../../src/components/SwipeCheckIn';
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
import { commitHaptic, errorHaptic } from '../../../src/lib/haptics';
import { duration, staggerDelay } from '../../../src/lib/motion';
import { useAuthedScreen } from '../../../src/lib/session';
import { useToast, useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, nativeSurface, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The home dashboard (`GET /me/home`) — and the app's daily action.
 *
 * Up next is a column of 72pt rows rather than web's three-across card grid: at
 * 362pt a card grid is one column anyway, and the row is the shape the swipe
 * check-in needs (`Mobile System.dc.html` §04) — which, from phase 4, it now
 * carries: drag a row right past 96pt and release. The button stays beside it
 * for the readers a pan cannot serve (`SwipeCheckIn`).
 *
 * The rule the swipe exists to serve is phase 3's and unchanged: the check-in
 * commits instantly, with **no confirmation dialog**, and an undo toast for
 * five seconds — "the cost of a wrong check-in is one tap". What phase 4 adds
 * is that the commit is now *visible* — the row leaves to the right over 220ms
 * and the column closes the gap — and reversible in the same motion: an undo,
 * or a write the server rejected, springs it back open.
 */
export default function HomeTab() {
  const { user, isPending: sessionPending } = useAuthedScreen();
  const { data, isPending, isError, refetch, isRefetching } = useHomeSummary();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const writeFailed = useWriteFailedToast();
  // Which rows this session has checked in. The row stays put until the next
  // `/me/home` lands (the server decides what "up next" is now), so it has to
  // say so itself — otherwise a second tap checks in the same part twice.
  const [checkedIn, setCheckedIn] = useState<ReadonlySet<string>>(new Set());

  const markCheckedIn = (entry: UpNextEntry, done: boolean) =>
    setCheckedIn((current) => {
      const set = new Set(current);
      if (done) set.add(upNextPartKey(entry));
      else set.delete(upNextPartKey(entry));
      return set;
    });

  const uncheck = useMutation({
    mutationFn: (entry: UpNextEntry) => trackingApi.uncheck(entry.id, entry.next),
    onMutate: (entry) => markCheckedIn(entry, false),
    onError: (error, entry) => {
      markCheckedIn(entry, true);
      errorHaptic();
      writeFailed(error, 'Couldn’t undo that — it’s still checked in.');
    },
    onSettled: () => invalidateTracking(queryClient),
  });

  const checkIn = useMutation({
    mutationFn: (entry: UpNextEntry) => trackingApi.checkIn(entry.id, entry.next),
    onMutate: (entry) => markCheckedIn(entry, true),
    onSuccess: (_result, entry) => {
      commitHaptic();
      toast({
        message: `${entry.title} — ${partLabel(entry)} checked in`,
        action: { label: 'Undo', onPress: () => uncheck.mutate(entry) },
      });
    },
    onError: (error, entry) => {
      markCheckedIn(entry, false);
      errorHaptic();
      writeFailed(error);
    },
    // Same sweep as the media screen: this also moves that title's detail, the
    // profile feed and history.
    onSettled: () => invalidateTracking(queryClient),
  });

  if (sessionPending || !user) {
    return (
      <PageFrame fadeOnFocus>
        <Loading />
      </PageFrame>
    );
  }

  return (
    <PageFrame fadeOnFocus>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.lg, paddingBottom: bottomInset },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.pink}
            colors={[color.pink]}
          />
        }
      >
        <PageTitle
          title="Up next"
          count={data ? `${data.upNext.length} waiting on you` : undefined}
        />

        {isPending ? (
          <SkeletonRows />
        ) : isError || !data ? (
          <EmptyState
            title="Couldn't load"
            body="The instance didn't answer. Pull down to try again."
          />
        ) : (
          <>
            {data.upNext.length === 0 ? (
              <EmptyState
                title="Nothing queued"
                body="Start something from Discover and its next episode shows up here."
              />
            ) : (
              <View style={styles.rows}>
                {data.upNext.map((entry, index) => (
                  <UpNextRow
                    key={upNextPartKey(entry)}
                    entry={entry}
                    index={index}
                    checkedIn={checkedIn.has(upNextPartKey(entry))}
                    onCheckIn={() => checkIn.mutate(entry)}
                  />
                ))}
              </View>
            )}

            {data.inProgress.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle title="In progress" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.shelf}
                >
                  {data.inProgress.map((entry, index) => (
                    <Animated.View
                      key={entry.id}
                      entering={FadeIn.delay(staggerDelay(index)).duration(duration.commit)}
                      layout={LinearTransition.duration(duration.commit)}
                    >
                      <Touchable href={`/media/${entry.slug}`}>
                        <Cover
                          kind={entry.kind}
                          title={entry.title}
                          coverUrl={entry.coverUrl}
                          width={96}
                          progress={entry.total ? entry.watched / entry.total : undefined}
                        />
                        <Text style={[type.bodySm, styles.shelfCaption]} numberOfLines={1}>
                          {entry.title}
                        </Text>
                        <Text style={[type.eyebrow, styles.dim]}>
                          {entry.total ? `${entry.watched} / ${entry.total}` : `${entry.watched}`}
                        </Text>
                      </Touchable>
                    </Animated.View>
                  ))}
                </ScrollView>
                {data.inProgress.length === IN_PROGRESS_LIMIT ? (
                  <Text style={[type.eyebrow, styles.shelfNote]}>
                    FIRST {IN_PROGRESS_LIMIT} · SEE HISTORY FOR THE REST
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionTitle title="This year" />
              <View style={styles.stats}>
                <Stat value={data.stats.episodesThisYear} label="Episodes" />
                <Stat value={data.stats.chaptersThisYear} label="Chapters" />
                <Stat value={data.stats.completedThisYear} label="Completed" />
                <Stat value={data.stats.dayStreak} label="Day streak" />
              </View>
            </View>

            {data.activity.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle title="Activity" />
                <GlassCard style={styles.activityCard}>
                  {data.activity.map((entry, index) => (
                    <Animated.View
                      key={`${entry.slug}-${entry.at}-${index}`}
                      entering={FadeIn.delay(staggerDelay(index)).duration(duration.commit)}
                      layout={LinearTransition.duration(duration.commit)}
                    >
                      <ActivityRow entry={entry} first={index === 0} />
                    </Animated.View>
                  ))}
                </GlassCard>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </PageFrame>
  );
}

/** 'E13' / 'CH204' — the part a row's check-in targets, in the row's own words. */
function partLabel(entry: UpNextEntry): string {
  return `${entry.partKind === 'episode' ? 'E' : 'CH'}${entry.next}`;
}

/**
 * One 72pt up-next row: 40×56 thumb, title, the part line, and the check-in.
 *
 * The row opens the title; the button inside it checks in; the whole row is
 * also the swipe target. A `Pressable` nested in a `Pressable` resolves to the
 * inner one on native, so the two tap targets do not fight — the invalid-markup
 * problem that forces web's card to keep the whole surface unlinked does not
 * exist here — and gesture-handler cancels the outer press the moment the pan
 * activates, so a swipe never also navigates.
 */
function UpNextRow({
  entry,
  index,
  checkedIn,
  onCheckIn,
}: {
  entry: UpNextEntry;
  index: number;
  checkedIn: boolean;
  onCheckIn: () => void;
}) {
  const verb = trackingVerbLabel(entry.kind).toUpperCase();
  const action = `${trackingVerbLabel(entry.kind, 'present')} ${partLabel(entry)}`;
  const press = usePressMotion();
  return (
    <Animated.View entering={FadeIn.delay(staggerDelay(index)).duration(duration.commit)}>
      <SwipeCheckIn
        label={action}
        armedLabel={`Release to ${action}`}
        committed={checkedIn}
        onCommit={onCheckIn}
      >
        <Touchable href={`/media/${entry.slug}`} style={styles.row}>
          <Cover
            kind={entry.kind}
            title={entry.title}
            coverUrl={entry.coverUrl}
            width={40}
            showTitle={false}
          />
          <View style={styles.rowBody}>
            <Text style={[type.cardTitle, styles.rowTitle]} numberOfLines={1}>
              {entry.title}
            </Text>
            <View style={styles.metaRow}>
              <KindDot kind={entry.kind} />
              <Text style={[type.eyebrow, styles.dim]}>
                {KIND_LABELS_SINGULAR[entry.kind]} · {partLabel(entry)}
                {entry.total ? ` OF ${entry.total}` : ''}
              </Text>
            </View>
          </View>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`Mark ${entry.title} ${partLabel(entry)} ${verb.toLowerCase()}`}
            accessibilityState={{ disabled: checkedIn }}
            accessibilityHint="Or swipe the row right"
            disabled={checkedIn}
            onPress={onCheckIn}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            android_ripple={ripple(true)}
            hitSlop={space.sm}
            style={[styles.check, checkedIn ? styles.checkDone : null, press.animatedStyle]}
          >
            <Text style={[type.button, checkedIn ? styles.dim : styles.pink]}>
              {checkedIn ? `✓ ${verb}` : '✓'}
            </Text>
          </AnimatedPressable>
        </Touchable>
      </SwipeCheckIn>
    </Animated.View>
  );
}

function ActivityRow({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  return (
    <Touchable
      href={`/media/${entry.slug}`}
      style={[styles.activityRow, !first && styles.activityDivider]}
    >
      <KindDot kind={entry.kind} />
      <Text style={[type.bodySm, styles.activityText]} numberOfLines={2}>
        {activityVerbLabel(entry)} {entry.title} <Text style={styles.dim}>{entry.detail}</Text>
      </Text>
      <Text style={[type.eyebrow, styles.dim]}>{relativeTime(entry.at)}</Text>
    </Touchable>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <GlassCard style={styles.stat}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{String(value)}</PrismText>
      </View>
      <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
  },
  section: {
    marginTop: layout.sectionGap,
  },
  rows: {
    // No `gap`: each row owns its own 8pt bottom margin, because a collapsing
    // row has to take its spacing with it — a `gap` would leave an 8pt hole
    // where the checked-in row used to be. The negative margin cancels the
    // trailing one so the next section keeps its 28.
    marginBottom: -space.sm,
  },
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: nativeSurface.row,
  },
  rowBody: {
    flex: 1,
    gap: space.xs,
  },
  rowTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  check: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  checkDone: {
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  pink: {
    color: color.pink,
  },
  shelf: {
    gap: space.md,
    paddingRight: layout.gutter,
  },
  shelfCaption: {
    color: color.fg,
    width: 96,
    marginTop: space.sm,
  },
  shelfNote: {
    color: color.faint,
    marginTop: space.md,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: space.lg,
    gap: space.xs,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  activityCard: {
    paddingHorizontal: space.lg,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: layout.touchTarget,
  },
  activityDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surface.divider,
  },
  activityText: {
    flex: 1,
    color: color.fg,
  },
  dim: {
    color: color.dim,
  },
});
