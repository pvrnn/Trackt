import { FlashList } from '@shopify/flash-list';
import { KIND_LABELS, LOG_STATUS_LABELS, groupEntries, useHistory } from '@trackt/client';
import {
  LOG_STATUSES,
  MEDIA_KINDS,
  type HistoryEntry,
  type LogStatus,
  type MediaKind,
} from '@trackt/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CollapsingHeader, HEADER_HEIGHT } from '../../src/components/CollapsingHeader';
import { FilterBar, type Filter, type MenuRow } from '../../src/components/FilterBar';
import { EntryCard, Total } from '../../src/components/HistoryCard';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  StaleNotice,
} from '../../src/components/Page';
import { duration, staggerDelay } from '../../src/lib/motion';
import { useAuthedScreen } from '../../src/lib/session';
import { color, gutter, layout, space } from '../../src/theme/tokens';
import { type } from '../../src/theme/typography';

/** The collapsed form for the filter cell; the menu spells each status out. */
const SHORT_STATUS: Record<LogStatus, string> = {
  planned: 'Planned',
  in_progress: 'Watching',
  completed: 'Done',
  paused: 'Paused',
  dropped: 'Dropped',
};

/** Statuses a history row can actually have — the server excludes `planned`. */
const HISTORY_STATUSES = LOG_STATUSES.filter((status) => status !== 'planned');

/**
 * How many rows a page's stagger runs across before it repeats. The list index
 * keeps climbing as pages append, and an absolute index would put every row
 * past the tenth at the cap — the same delay, which is no stagger at all.
 */
const PAGE_STAGGER_SPAN = 8;

/**
 * One list row: either a month heading or a pair of poster cards.
 *
 * A flat stream rather than nested lists, because a `FlashList` per group
 * recycles nothing — and the 2-up grid the mobile design calls for is a pair per
 * row, so the pairing happens here rather than via `numColumns` (which cannot
 * interleave headings between its cells).
 */
type Row =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'pair'; key: string; entries: HistoryEntry[] };

/**
 * History (`GET /me/history`, ADR-0007), reached from Profile rather than from
 * the tab bar.
 *
 * Three axes over the shared `FilterBar`: year, kind and status. Quarters are
 * still a grouping, but no longer something you filter by.
 */
export default function HistoryScreen() {
  const { user, isPending: sessionPending } = useAuthedScreen();
  const [year, setYear] = useState<number | undefined>(undefined);
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const [status, setStatus] = useState<LogStatus | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const {
    entries,
    years,
    totals,
    updatedAt,
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    loadMore,
  } = useHistory({ year, kind, status });

  const cardWidth = Math.floor((width - layout.gutter * 2 - space.md) / 2);

  const rows = useMemo<Row[]>(() => {
    const groups = groupEntries(entries, 'month', year === undefined);
    const out: Row[] = [];
    for (const group of groups) {
      out.push({ kind: 'heading', key: `h:${group.key}`, label: group.label });
      for (let i = 0; i < group.entries.length; i += 2) {
        out.push({
          kind: 'pair',
          key: `p:${group.key}:${i}`,
          entries: group.entries.slice(i, i + 2),
        });
      }
    }
    return out;
  }, [entries, year]);

  const yearRows: MenuRow[] = [
    { key: 'all', label: 'All time', selected: year === undefined },
    ...years.map((entry) => ({
      key: String(entry.year),
      label: String(entry.year),
      count: String(entry.count),
      selected: year === entry.year,
    })),
  ];

  const filters: Filter[] = [
    {
      key: 'year',
      icon: 'clock',
      caption: 'Year',
      label: year === undefined ? 'All time' : String(year),
      rows: yearRows,
      onSelect: (key) => setYear(key === 'all' ? undefined : Number(key)),
    },
    {
      key: 'kind',
      icon: 'list',
      caption: 'Kind',
      label: kind ? KIND_LABELS[kind] : 'All',
      rows: [
        { key: 'all', label: 'All kinds', selected: kind === undefined },
        ...MEDIA_KINDS.map((value) => ({
          key: value,
          label: KIND_LABELS[value],
          selected: kind === value,
        })),
      ],
      onSelect: (key) => setKind(key === 'all' ? undefined : (key as MediaKind)),
    },
    {
      key: 'status',
      icon: 'check',
      caption: 'Status',
      label: status ? SHORT_STATUS[status] : 'Any',
      rows: [
        { key: 'all', label: 'Any status', selected: status === undefined },
        ...HISTORY_STATUSES.map((value) => ({
          key: value,
          label: LOG_STATUS_LABELS[value],
          selected: status === value,
        })),
      ],
      onSelect: (key) => setStatus(key === 'all' ? undefined : (key as LogStatus)),
    },
  ];

  const scrollY = useSharedValue(0);

  if (sessionPending || !user) {
    return (
      <PageFrame>
        <Loading />
      </PageFrame>
    );
  }

  const scope = year === undefined ? 'ALL TIME' : String(year);
  const filtered = kind !== undefined || status !== undefined;

  return (
    <PageFrame>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + HEADER_HEIGHT + space.md }}>
            <View style={gutter}>
              <PageTitle title="History" count={`${totals.titles} titles · ${scope}`} />
              <StaleNotice updatedAt={updatedAt} />
            </View>

            <FilterBar filters={filters} variant="columns" />

            {/* Keyed on the scope, so switching year re-mounts the row and it
                cross-fades to the new numbers. Four totals changing in place
                is the one moment on this screen where nothing moves and
                everything is different — the fade is what says the chip above
                did that. */}
            <Animated.View
              key={scope}
              entering={FadeIn.duration(duration.commit)}
              style={[gutter, styles.totals]}
            >
              <Total value={totals.titles} label="Titles" scope={scope} />
              <Total value={totals.completed} label="Completed" scope={scope} />
              <Total value={totals.episodes} label="Episodes" scope={scope} />
              <Total value={totals.chapters} label="Chapters" scope={scope} />
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View style={gutter}>
            {isLoading ? (
              <OfflineFallback>
                <Loading />
              </OfflineFallback>
            ) : isError ? (
              <EmptyState title="Couldn't load" body="The instance didn't answer." />
            ) : filtered ? (
              <EmptyState
                title="Nothing matches"
                body="No titles in this kind and status. Clear one of them to widen the view."
              />
            ) : year !== undefined ? (
              <EmptyState
                title="Nothing in this window"
                body="You tracked nothing here. Pick another year from the chips above."
              />
            ) : (
              <EmptyState
                title="Nothing yet"
                body="Titles land here once you start or finish them. Find something in Discover."
              />
            )}
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? <ActivityIndicator color={color.pink} style={styles.footer} /> : null
        }
        renderItem={({ item, index }) =>
          item.kind === 'heading' ? (
            <Text style={[type.section, styles.heading]}>{item.label}</Text>
          ) : (
            // A new keyset page appends rather than jumps: the rows it brings
            // fade in in sequence. `entering` runs on mount only, so the rows
            // already on screen are untouched and a recycled cell does not
            // re-fade as it scrolls back into view.
            <Animated.View
              entering={FadeIn.delay(staggerDelay(index % PAGE_STAGGER_SPAN)).duration(
                duration.commit,
              )}
              style={styles.pair}
            >
              {item.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} width={cardWidth} />
              ))}
            </Animated.View>
          )
        }
      />

      <CollapsingHeader title="History" scrollY={scrollY} />
    </PageFrame>
  );
}

const styles = StyleSheet.create({
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.lg,
  },
  heading: {
    color: color.fg,
    paddingHorizontal: layout.gutter,
    paddingTop: layout.sectionGap,
    paddingBottom: space.md,
  },
  pair: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    marginBottom: space.md,
  },
  footer: {
    paddingVertical: space.xl,
  },
});
