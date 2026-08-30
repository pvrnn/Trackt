import { useMutation } from '@tanstack/react-query';
import { upNextPartKey, useHomeSummary } from '@trackt/client';
import { IN_PROGRESS_LIMIT, type UpNextEntry } from '@trackt/shared';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../../src/components/GlassCard';
import {
  EmptyState,
  Loading,
  PageFrame,
  PageTitle,
  QueryState,
  SectionTitle,
  pullToRefresh,
  useTabContentInset,
} from '../../../src/components/Page';
import {
  ActivityRow,
  UpNextRow,
  checkInWrite,
  partLabel,
  undoWrite,
} from '../../../src/components/HomeRows';
import { Shelf, ShelfItem } from '../../../src/components/Shelf';
import { Stat, Stats } from '../../../src/components/Stat';
import { SkeletonRows } from '../../../src/components/Skeleton';
import { commitHaptic, errorHaptic } from '../../../src/lib/haptics';
import { duration, staggerDelay } from '../../../src/lib/motion';
import { useIsOnline } from '../../../src/lib/network';
import { TRACKING_MUTATION_KEY, type PartWrite } from '../../../src/lib/offline';
import { useAuthedScreen } from '../../../src/lib/session';
import { useToast, useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, space } from '../../../src/theme/tokens';
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
  const { data, dataUpdatedAt, isPending, isError, refetch, isRefetching } = useHomeSummary();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();
  const toast = useToast();
  const writeFailed = useWriteFailedToast();
  // Which rows this session has checked in. The row stays put until the next
  // `/me/home` lands (the server decides what "up next" is now), so it has to
  // say so itself — otherwise a second tap checks in the same part twice.
  const [checkedIn, setCheckedIn] = useState<ReadonlySet<string>>(new Set());

  const markCheckedIn = (write: PartWrite, done: boolean) =>
    setCheckedIn((current) => {
      const set = new Set(current);
      const key = upNextPartKey({ id: write.id, next: write.part });
      if (done) set.add(key);
      else set.delete(key);
      return set;
    });

  /** The row a write refers to, as the dashboard stood when it was tapped. */
  const entryFor = (write: { id: string; part: number }): UpNextEntry | null =>
    data?.upNext.find((row) => row.id === write.id && row.next === write.part) ?? null;

  /** The commit: the buzz §07 allows, and the five-second undo window. */
  const commit = (entry: UpNextEntry, queued: boolean) => {
    commitHaptic();
    toast({
      message: `${entry.title} — ${partLabel(entry)} checked in${queued ? ' · will sync' : ''}`,
      action: { label: 'Undo', onPress: () => uncheck.mutate(undoWrite(entry)) },
    });
  };

  // Two observers, and no `mutationFn` or `onSettled` on either: both come from
  // the client's defaults for this key, which is the copy a write that was
  // paused offline and restored from disk can also reach (phase 5). The
  // invalidation is therefore the same four-key sweep the media screen runs, so
  // a check-in here also moves that title's detail, the profile feed and
  // history.
  //
  // The callbacks are options-level rather than passed to `mutate()`, which
  // matters more than it looks: a second `mutate()` on the same observer
  // detaches the first mutation from it, and per-call callbacks live on the
  // observer. Two rows tapped in quick succession would have silently lost the
  // first one's toast and its rollback.
  const uncheck = useMutation<void, Error, PartWrite>({
    mutationKey: TRACKING_MUTATION_KEY,
    onMutate: (write) => markCheckedIn(write, false),
    onError: (error, write) => {
      markCheckedIn(write, true);
      errorHaptic();
      writeFailed(error, 'Couldn’t undo that — it’s still checked in.');
    },
  });

  const checkIn = useMutation<
    void,
    Error,
    PartWrite,
    { entry: UpNextEntry | null; queued: boolean }
  >({
    mutationKey: TRACKING_MUTATION_KEY,
    onMutate: (write) => {
      markCheckedIn(write, true);
      // Offline the write is queued rather than sent, so there is no 200 coming
      // to hang the commit off — and the undo window has to open now or never.
      // Online it still waits for the server, which is what makes the undo a
      // real undo rather than a promise.
      const entry = entryFor(write);
      const queued = !isOnline;
      if (queued && entry) commit(entry, true);
      return { entry, queued };
    },
    onSuccess: (_data, _write, context) => {
      if (context && !context.queued && context.entry) commit(context.entry, false);
    },
    onError: (error, write) => {
      markCheckedIn(write, false);
      errorHaptic();
      writeFailed(error);
    },
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
        refreshControl={pullToRefresh(isRefetching, () => void refetch())}
      >
        <PageTitle
          title="Up next"
          count={data ? `${data.upNext.length} waiting on you` : undefined}
        />

        <QueryState
          query={{ data, isPending, isError, dataUpdatedAt }}
          pending={<SkeletonRows />}
          error={{
            title: "Couldn't load",
            body: "The instance didn't answer. Pull down to try again.",
          }}
        >
          {(data) => (
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
                      onCheckIn={() => checkIn.mutate(checkInWrite(entry))}
                    />
                  ))}
                </View>
              )}

              {data.inProgress.length > 0 ? (
                <View style={styles.section}>
                  <SectionTitle title="In progress" />
                  <Shelf padding="right">
                    {data.inProgress.map((entry, index) => (
                      <Animated.View
                        key={entry.id}
                        entering={FadeIn.delay(staggerDelay(index)).duration(duration.commit)}
                        layout={LinearTransition.duration(duration.commit)}
                      >
                        <ShelfItem
                          href={`/media/${entry.slug}`}
                          kind={entry.kind}
                          title={entry.title}
                          coverUrl={entry.coverUrl}
                          progress={entry.total ? entry.watched / entry.total : undefined}
                          note={
                            entry.total ? `${entry.watched} / ${entry.total}` : `${entry.watched}`
                          }
                        />
                      </Animated.View>
                    ))}
                  </Shelf>
                  {data.inProgress.length === IN_PROGRESS_LIMIT ? (
                    <Text style={[type.eyebrow, styles.shelfNote]}>
                      FIRST {IN_PROGRESS_LIMIT} · SEE HISTORY FOR THE REST
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.section}>
                <SectionTitle title="This year" />
                <Stats>
                  <Stat value={data.stats.episodesThisYear} label="Episodes" />
                  <Stat value={data.stats.chaptersThisYear} label="Chapters" />
                  <Stat value={data.stats.completedThisYear} label="Completed" />
                  <Stat value={data.stats.dayStreak} label="Day streak" />
                </Stats>
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
        </QueryState>
      </ScrollView>
    </PageFrame>
  );
}

/** 'E13' / 'CH204' — the part a row's check-in targets, in the row's own words. */
/** The two writes an up-next row can produce, as values (`lib/offline.ts`). */
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
  // No pill, no fill, no border. `Mobile System.dc.html` §04 ends this row with
  // a `›` in #3d3846 — "a dim chevron is the only affordance" — because the
  // swipe is the action and the row is already a link. A filled 44pt pink disc
  // sitting beside a 40×56 cover reads as the loudest thing in the row, which
  // inverts that. What stays is the 44pt target and the tick, because the glyph
  // has to say *check in* rather than *open* — a chevron here would name the
  // wrong action. The weight comes off; the control does not.

  shelfNote: {
    color: color.faint,
    marginTop: space.md,
  },
  activityCard: {
    paddingHorizontal: space.lg,
  },
});
