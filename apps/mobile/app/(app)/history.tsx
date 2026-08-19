import { FlashList } from '@shopify/flash-list';
import {
  KIND_LABELS,
  LOG_STATUS_LABELS,
  dateRangeLabel,
  groupEntries,
  useHistory,
} from '@trackt/client';
import {
  HISTORY_SEASONS,
  LOG_STATUSES,
  MEDIA_KINDS,
  type HistoryEntry,
  type HistorySeason,
  type LogStatus,
  type MediaKind,
} from '@trackt/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, ChipDivider, ChipRow } from '../../src/components/Chip';
import { Cover } from '../../src/components/Cover';
import { GlassCard } from '../../src/components/GlassCard';
import { KindDot } from '../../src/components/KindDot';
import { BackLink, EmptyState, Loading, PageFrame, PageTitle } from '../../src/components/Page';
import { Touchable } from '../../src/components/Touchable';
import { PrismText } from '../../src/components/PrismText';
import { duration, staggerDelay } from '../../src/lib/motion';
import { useAuthedScreen } from '../../src/lib/session';
import { color, layout, radius, space, surface } from '../../src/theme/tokens';
import { type } from '../../src/theme/typography';

/** Statuses a history row can actually have — the server excludes `planned`. */
const HISTORY_STATUSES = LOG_STATUSES.filter((status) => status !== 'planned');

/**
 * How many rows a page's stagger runs across before it repeats. The list index
 * keeps climbing as pages append, and an absolute index would put every row
 * past the tenth at the cap — the same delay, which is no stagger at all.
 */
const PAGE_STAGGER_SPAN = 8;

/**
 * Per-status colour, from `docs/design/History.dc.html`: in-progress is the live
 * pink, paused the warm gold, completed a settled neutral, dropped recedes.
 */
const STATUS_COLORS: Record<LogStatus, string> = {
  planned: color.dim,
  in_progress: color.pink,
  completed: color.fg,
  paused: color.gold,
  dropped: color.faint,
};

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
 * Web's year rail is a sidebar; here it is the first of two chip rows, with the
 * season chips beside it behind a hairline. The season slot is always rendered
 * and dims to inert on ALL TIME — exactly as on web, and for the same reason:
 * changing the year must not reflow everything under it.
 */
export default function HistoryScreen() {
  const { user, isPending: sessionPending } = useAuthedScreen();
  const [year, setYear] = useState<number | undefined>(undefined);
  const [season, setSeason] = useState<HistorySeason | undefined>(undefined);
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const [status, setStatus] = useState<LogStatus | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const { entries, years, totals, isLoading, isError, isLoadingMore, hasMore, loadMore } =
    useHistory({ year, season, kind, status });

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

  if (sessionPending || !user) {
    return (
      <PageFrame>
        <Loading />
      </PageFrame>
    );
  }

  const scope =
    year === undefined ? 'ALL TIME' : season ? `${season.toUpperCase()} ${year}` : String(year);
  const filtered = kind !== undefined || status !== undefined;

  return (
    <PageFrame>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.md }}>
            <View style={styles.gutter}>
              <BackLink label="Profile" />
              <PageTitle title="History" count={`${totals.titles} titles · ${scope}`} />
            </View>

            <ChipRow>
              <Chip
                label="All time"
                selected={year === undefined}
                onPress={() => {
                  setYear(undefined);
                  setSeason(undefined);
                }}
              />
              {years.map((entry) => (
                <Chip
                  key={entry.year}
                  label={`${entry.year} · ${entry.count}`}
                  selected={year === entry.year}
                  onPress={() => {
                    setYear(entry.year);
                    setSeason(undefined);
                  }}
                />
              ))}
              <ChipDivider />
              {/* Always rendered: on ALL TIME it dims and stops responding, so
                  picking a year never reflows the rows below. */}
              {HISTORY_SEASONS.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  disabled={year === undefined}
                  selected={season === value}
                  onPress={() => setSeason(season === value ? undefined : value)}
                />
              ))}
            </ChipRow>

            <View style={styles.secondRow}>
              <ChipRow>
                <Chip
                  label="All"
                  selected={kind === undefined}
                  onPress={() => setKind(undefined)}
                />
                {MEDIA_KINDS.map((value) => (
                  <Chip
                    key={value}
                    label={KIND_LABELS[value]}
                    selected={kind === value}
                    onPress={() => setKind(kind === value ? undefined : value)}
                  />
                ))}
                <ChipDivider />
                {HISTORY_STATUSES.map((value) => (
                  <Chip
                    key={value}
                    label={LOG_STATUS_LABELS[value]}
                    selected={status === value}
                    onPress={() => setStatus(status === value ? undefined : value)}
                  />
                ))}
              </ChipRow>
            </View>

            {/* Keyed on the scope, so switching year re-mounts the row and it
                cross-fades to the new numbers. Four totals changing in place
                is the one moment on this screen where nothing moves and
                everything is different — the fade is what says the chip above
                did that. */}
            <Animated.View
              key={scope}
              entering={FadeIn.duration(duration.commit)}
              style={[styles.gutter, styles.totals]}
            >
              <Total value={totals.titles} label="Titles" scope={scope} />
              <Total value={totals.completed} label="Completed" scope={scope} />
              <Total value={totals.episodes} label="Episodes" scope={scope} />
              <Total value={totals.chapters} label="Chapters" scope={scope} />
            </Animated.View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.gutter}>
            {isLoading ? (
              <Loading />
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
    </PageFrame>
  );
}

/**
 * One self-contained poster card. Nothing legibility-critical sits on raw
 * artwork (design brief): the status and score ride opaque chips, and the title
 * plate below the cover is solid `#12101A`, so a white poster and a black one
 * read identically.
 */
function EntryCard({ entry, width }: { entry: HistoryEntry; width: number }) {
  const range = dateRangeLabel(entry.startedAt, entry.finishedAt);
  return (
    <Touchable href={`/media/${entry.slug}`} style={[{ width }, styles.card]}>
      <View>
        <Cover kind={entry.kind} title={entry.title} coverUrl={entry.coverUrl} width={width} />
        <View style={styles.pills}>
          <Text style={[type.eyebrow, styles.pill, { color: STATUS_COLORS[entry.status] }]}>
            {LOG_STATUS_LABELS[entry.status]}
          </Text>
          {entry.score !== null ? (
            <Text style={[type.eyebrow, styles.pill, styles.score]}>{entry.score}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.plate}>
        <Text style={[type.cardTitle, styles.plateTitle]} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <KindDot kind={entry.kind} />
          <Text style={[type.eyebrow, styles.dim]} numberOfLines={1}>
            {range ?? '—'}
          </Text>
        </View>
        {/* `24 / 24` on a finished title is noise, so progress shows only
              while there is progress left to make. */}
        {entry.status !== 'completed' && entry.total ? (
          <Text style={[type.eyebrow, styles.dim]}>
            {entry.watched} / {entry.total}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

function Total({ value, label, scope }: { value: number; label: string; scope: string }) {
  return (
    <GlassCard style={styles.total}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{String(value)}</PrismText>
      </View>
      <View>
        <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
        <Text style={[type.eyebrow, styles.faint]}>{scope}</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: layout.gutter,
  },
  secondRow: {
    marginTop: space.sm,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.lg,
  },
  total: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  shrink: {
    alignSelf: 'flex-start',
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
  card: {
    borderRadius: radius.cover,
    overflow: 'hidden',
    backgroundColor: '#12101a',
  },
  pills: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  pill: {
    backgroundColor: 'rgba(14,12,16,0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  score: {
    color: color.pink,
  },
  plate: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surface.glassBorder,
    padding: space.md,
    gap: space.xs,
  },
  plateTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dim: {
    color: color.dim,
  },
  faint: {
    color: color.faint,
  },
  footer: {
    paddingVertical: space.xl,
  },
});
