import { useMutation } from '@tanstack/react-query';
import { upNextPartKey, useHomeSummary, useTrackedNews } from '@trackt/client';
import { IN_PROGRESS_LIMIT, type HomeSummary, type UpNextEntry } from '@trackt/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../src/components/Avatar';
import { HomeLink, HomeSectionHead, NewsBrief, NewsLead } from '../../../src/components/HomeNews';
import { Icon } from '../../../src/components/Icon';
import {
  EmptyState,
  Loading,
  PageFrame,
  QueryState,
  pullToRefresh,
  useTabContentInset,
} from '../../../src/components/Page';
import { PrismText } from '../../../src/components/PrismText';
import { UpNextRow, checkInWrite, partLabel, undoWrite } from '../../../src/components/HomeRows';
import { SkeletonRows } from '../../../src/components/Skeleton';
import { Touchable } from '../../../src/components/Touchable';
import { commitHaptic, errorHaptic } from '../../../src/lib/haptics';
import { useIsOnline } from '../../../src/lib/network';
import { TRACKING_MUTATION_KEY, type PartWrite } from '../../../src/lib/offline';
import { useAuthedScreen } from '../../../src/lib/session';
import { useToast, useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, space, text } from '../../../src/theme/tokens';
import { displayLine, font, type } from '../../../src/theme/typography';

/** How many in-progress titles feed "news from what you track": one read each. */
const NEWS_SOURCES = 4;
const NEWS_SHOWN = 3;

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
  const news = useTrackedNews(
    (data?.inProgress ?? []).slice(0, NEWS_SOURCES).map((entry) => entry.id),
    NEWS_SHOWN,
  );
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();
  const toast = useToast();
  const { t } = useTranslation();
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
      message: t(queued ? 'home.checkedInQueued' : 'home.checkedIn', {
        title: entry.title,
        part: partLabel(entry),
      }),
      action: { label: t('home.undo'), onPress: () => uncheck.mutate(undoWrite(entry)) },
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
      writeFailed(error, t('home.undoFailed'));
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

  const android = Platform.OS === 'android';
  const subtitle = data ? waitingLabel(t, data.upNext) : '';
  const avatar = (size: number) => (
    <Touchable href="/profile" style={styles.target} accessibilityLabel={t('home.profile')}>
      <Avatar name={user.name} image={user.image} size={size} />
    </Touchable>
  );

  return (
    <PageFrame fadeOnFocus>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.lg, paddingBottom: bottomInset },
        ]}
        refreshControl={pullToRefresh(isRefetching, () => {
          void refetch();
          news.refetch();
        })}
      >
        {android ? (
          <View style={styles.appBar}>
            <PrismText style={styles.wordmark}>TRACKT</PrismText>
            <View style={styles.appBarActions}>
              <Touchable
                href="/discover"
                style={styles.target}
                accessibilityLabel={t('home.search')}
              >
                <Icon name="search" color={color.dim} />
              </Touchable>
              {avatar(32)}
            </View>
          </View>
        ) : null}

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[type.title, text.fg]}>{t('home.title').toUpperCase()}</Text>
            {subtitle ? (
              android ? (
                <Text style={[type.eyebrow, text.dim]}>{subtitle}</Text>
              ) : (
                <View style={styles.shrink}>
                  <PrismText style={type.eyebrow}>{subtitle}</PrismText>
                </View>
              )
            ) : null}
          </View>
          {android ? null : avatar(36)}
        </View>

        <QueryState
          query={{ data, isPending, isError, dataUpdatedAt }}
          pending={<SkeletonRows />}
          error={{
            title: t('media.loadFailed.title'),
            body: t('home.loadError'),
          }}
        >
          {(data) => (
            <>
              {data.upNext.length === 0 ? (
                <EmptyState title={t('home.nothingQueued')} body={t('home.nothingQueuedBody')} />
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
                <View style={styles.library}>
                  <Text style={[type.eyebrow, text.dim]}>
                    {data.inProgress.length >= IN_PROGRESS_LIMIT
                      ? t('home.inProgressMore', { count: IN_PROGRESS_LIMIT })
                      : t('home.inProgressCount', { count: data.inProgress.length })}
                  </Text>
                  <HomeLink href="/history?status=in_progress" label={t('home.seeAll')} />
                </View>
              ) : null}

              {news.articles.length > 0 ? (
                <View style={styles.section}>
                  <HomeSectionHead
                    title={t('home.news.title')}
                    caption={t('home.news.caption')}
                    action={<HomeLink href="/news" label={t('home.news.all')} />}
                  />
                  {news.articles.map((article, index) =>
                    index === 0 ? (
                      <NewsLead key={article.id} article={article} />
                    ) : (
                      <NewsBrief key={article.id} article={article} />
                    ),
                  )}
                </View>
              ) : null}
            </>
          )}
        </QueryState>
      </ScrollView>
    </PageFrame>
  );
}

/** '2 EPISODES · 1 CHAPTER' — what the up-next rows hold, by part. */
function waitingLabel(t: TFunction, upNext: HomeSummary['upNext']): string {
  const episodes = upNext.filter((entry) => entry.partKind === 'episode').length;
  const chapters = upNext.length - episodes;
  return [
    episodes ? t('home.pending.episodes', { count: episodes }) : null,
    chapters ? t('home.pending.chapters', { count: chapters }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  wordmark: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: displayLine(26),
  },
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  target: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    paddingBottom: space.lg,
  },
  headerText: {
    flexShrink: 1,
    gap: 3,
  },
  // PrismText sizes itself to its mask, so it needs a shrink-to-fit parent.
  shrink: {
    alignSelf: 'flex-start',
  },
  rows: {
    // No `gap`: each row owns its own 8pt bottom margin, because a collapsing
    // row has to take its spacing with it. The negative margin cancels the
    // trailing one.
    marginBottom: -space.sm,
  },
  library: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  section: {
    marginTop: layout.sectionGap,
    gap: space.md,
  },
});
