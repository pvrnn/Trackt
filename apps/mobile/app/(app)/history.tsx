import { FlashList } from '@shopify/flash-list';
import { groupEntries, useHistory } from '@trackt/client';
import { MEDIA_KINDS, type HistoryEntry, type LogStatus, type MediaKind } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CollapsingHeader, HEADER_HEIGHT } from '../../src/components/CollapsingHeader';
import { HistoryRow, HistoryStrip } from '../../src/components/HistoryCard';
import { Icon } from '../../src/components/Icon';
import { KIND_COLORS } from '../../src/components/KindDot';
import { MiniTimeline, useTimelineHistory } from '../../src/components/MiniTimeline';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  StaleNotice,
} from '../../src/components/Page';
import { Sheet, useSheetController } from '../../src/components/Sheet';
import { Skeleton } from '../../src/components/Skeleton';
import { intlLocale } from '../../src/i18n';
import { useLabels } from '../../src/lib/labels';
import { duration, staggerDelay } from '../../src/lib/motion';
import { useAuthedScreen } from '../../src/lib/session';
import {
  PRISM,
  color,
  gutter,
  layout,
  radius,
  space,
  stroke,
  surface,
} from '../../src/theme/tokens';
import { font, type } from '../../src/theme/typography';

/** The statuses a history row can have, in the design's order; the server excludes `planned`. */
const HISTORY_STATUSES = [
  'completed',
  'in_progress',
  'paused',
  'dropped',
] as const satisfies LogStatus[];

/**
 * How many rows a page's stagger runs across before it repeats. The list index
 * keeps climbing as pages append, and an absolute index would put every row
 * past the tenth at the cap — the same delay, which is no stagger at all.
 */
const PAGE_STAGGER_SPAN = 8;

/** One list row, flat so a single `FlashList` recycles across month headings. */
type Row =
  | { kind: 'heading'; key: string; label: string; meta: string }
  | { kind: 'entry'; key: string; entry: HistoryEntry };

type Picker = 'year' | 'status' | null;

/**
 * History (`GET /me/history`, ADR-0007), reached from Profile rather than from
 * the tab bar (`Mobile App.dc.html`, HISTORY): one filter slab, the totals, the
 * mini arrow of time, then the same titles as a list grouped by month.
 */
export default function HistoryScreen() {
  const { user, isPending: sessionPending } = useAuthedScreen();
  // Absent means this year: the page opens on what you're watching now.
  const [year, setYear] = useState<number | undefined>(() => new Date().getUTCFullYear());
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<LogStatus | undefined>(() =>
    HISTORY_STATUSES.find((value) => value === params.status),
  );
  const [picker, setPicker] = useState<Picker>(null);
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const labels = useLabels();
  const locale = intlLocale(i18n.language);

  const history = useHistory({ year, kind, status });
  const { entries, years, kinds, totals, updatedAt, isLoading, isError } = history;
  // The timeline draws the whole span and scrolls to the year rather than filtering to it.
  const timeline = useTimelineHistory({ kind, status });

  const rows = useMemo<Row[]>(() => {
    const groups = groupEntries(entries, 'month', year === undefined, locale);
    const out: Row[] = [];
    for (const group of groups) {
      out.push({
        kind: 'heading',
        key: `h:${group.key}`,
        label: group.label,
        meta: t('history.titles', { count: group.entries.length }),
      });
      for (const entry of group.entries) out.push({ kind: 'entry', key: entry.id, entry });
    }
    return out;
  }, [entries, year, locale, t]);

  const scrollY = useSharedValue(0);

  if (sessionPending || !user) {
    return (
      <PageFrame>
        <Loading />
      </PageFrame>
    );
  }

  const scope = year === undefined ? t('history.allTime') : String(year);
  const filtered = kind !== undefined || status !== undefined;
  const kindTotal = Object.values(kinds).reduce((sum, count) => sum + (count ?? 0), 0);
  const currentYear = new Date().getUTCFullYear();
  const yearOptions = [
    ...(years.some((entry) => entry.year === currentYear)
      ? []
      : [{ key: String(currentYear), label: String(currentYear) }]),
    ...years.map((entry) => ({
      key: String(entry.year),
      label: String(entry.year),
      count: String(entry.count),
    })),
    { key: 'all', label: t('history.allTime') },
  ];
  const statusOptions = [
    { key: 'all', label: t('common.all') },
    ...HISTORY_STATUSES.map((value) => ({ key: value, label: labels.status(value) })),
  ];

  return (
    <PageFrame>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (history.hasMore) history.loadMore();
        }}
        ListHeaderComponent={
          <View
            style={[gutter, styles.header, { paddingTop: insets.top + HEADER_HEIGHT + space.md }]}
          >
            <View>
              <PageTitle
                title={t('history.title')}
                count={t('history.scope', {
                  scope,
                  titles: t('history.titles', { count: totals.titles }),
                })}
              />
              <StaleNotice updatedAt={updatedAt} />
            </View>

            <View style={styles.slab}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabs}
              >
                <KindTab
                  label={t('common.all')}
                  count={kindTotal}
                  active={kind === undefined}
                  onPress={() => setKind(undefined)}
                />
                {MEDIA_KINDS.map((value) => (
                  <KindTab
                    key={value}
                    label={labels.kind(value)}
                    dot={KIND_COLORS[value]}
                    count={kinds[value] ?? 0}
                    active={kind === value}
                    onPress={() => setKind(value)}
                  />
                ))}
              </ScrollView>
              <View style={styles.cells}>
                <FilterCell
                  caption={t('history.filters.year')}
                  value={scope}
                  onPress={() => setPicker('year')}
                />
                <FilterCell
                  caption={t('history.filters.status')}
                  value={status ? labels.status(status) : t('common.all')}
                  ruled
                  onPress={() => setPicker('status')}
                />
              </View>
            </View>

            {/* Keyed on the scope, so switching year cross-fades to the new numbers. */}
            <Animated.View key={scope} entering={FadeIn.duration(duration.commit)}>
              <HistoryStrip
                stats={[
                  { value: totals.completed, label: t('history.strip.completed') },
                  { value: totals.titles, label: t('history.strip.titles') },
                  { value: totals.episodes, label: t('history.strip.episodes') },
                  { value: totals.chapters, label: t('history.strip.chapters') },
                ]}
              />
            </Animated.View>

            {timeline.ready ? (
              timeline.entries.length > 0 ? (
                <MiniTimeline entries={timeline.entries} jumpYear={year ?? 'all'} />
              ) : null
            ) : timeline.isError ? null : (
              <Skeleton style={styles.timelineSkeleton} />
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={gutter}>
            {isLoading ? (
              <OfflineFallback>
                <Loading />
              </OfflineFallback>
            ) : isError ? (
              <EmptyState title={t('media.loadFailed.title')} body={t('history.loadError')} />
            ) : filtered ? (
              <EmptyState
                title={t('history.empty.filteredTitle')}
                body={t('history.empty.filteredBody', { scope })}
              />
            ) : year !== undefined ? (
              <EmptyState
                title={t('history.empty.windowTitle', { scope })}
                body={t('history.empty.windowBody')}
              />
            ) : (
              <EmptyState
                title={t('history.empty.nothingTitle')}
                body={t('history.empty.nothingBody')}
              />
            )}
          </View>
        }
        ListFooterComponent={
          history.isLoadingMore ? (
            <ActivityIndicator color={color.pink} style={styles.footer} />
          ) : null
        }
        renderItem={({ item, index }) =>
          item.kind === 'heading' ? (
            <View style={[gutter, styles.heading]}>
              <Text style={[type.section, styles.headingLabel]}>{item.label}</Text>
              <Text style={[type.tabLabel, styles.headingMeta]}>{item.meta}</Text>
            </View>
          ) : (
            // A new keyset page appends rather than jumps: its rows fade in in sequence.
            <Animated.View
              entering={FadeIn.delay(staggerDelay(index % PAGE_STAGGER_SPAN)).duration(
                duration.commit,
              )}
              style={gutter}
            >
              <HistoryRow entry={item.entry} />
            </Animated.View>
          )
        }
      />

      <CollapsingHeader title={t('history.title')} scrollY={scrollY} />

      {picker === 'year' ? (
        <PickSheet
          title={t('history.filters.year')}
          options={yearOptions}
          selected={year === undefined ? 'all' : String(year)}
          onPick={(key) => setYear(key === 'all' ? undefined : Number(key))}
          onClose={() => setPicker(null)}
        />
      ) : picker === 'status' ? (
        <PickSheet
          title={t('history.filters.status')}
          options={statusOptions}
          selected={status ?? 'all'}
          onPick={(key) => setStatus(key === 'all' ? undefined : (key as LogStatus))}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </PageFrame>
  );
}

function KindTab({
  label,
  count,
  dot,
  active,
  onPress,
}: {
  label: string;
  count: number;
  dot?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      android_ripple={{ color: surface.pinkRow }}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
    >
      {dot ? <View style={[styles.tabDot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.tabLabel, { color: active ? color.fg : color.muted }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[styles.tabLabel, styles.tabCount]}>{count}</Text>
      {active ? (
        <LinearGradient
          colors={[...PRISM]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.tabRule}
        />
      ) : null}
    </Pressable>
  );
}

function FilterCell({
  caption,
  value,
  ruled = false,
  onPress,
}: {
  caption: string;
  value: string;
  ruled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${caption}: ${value}`}
      onPress={onPress}
      android_ripple={{ color: surface.pinkRow }}
      style={({ pressed }) => [
        styles.cell,
        ruled ? styles.cellRule : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.tabLabel, styles.cellCaption]}>{caption.toUpperCase()}</Text>
      <Text numberOfLines={1} style={[type.label, styles.cellValue]}>
        {value.toUpperCase()}
      </Text>
      <Icon name="caret-down" color={color.muted} size={11} />
    </Pressable>
  );
}

function PickSheet({
  title,
  options,
  selected,
  onPick,
  onClose,
}: {
  title: string;
  options: { key: string; label: string; count?: string }[];
  selected: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  return (
    <Sheet title={title} controller={sheet} tall={options.length > 6}>
      <View style={styles.options}>
        {options.map((option) => {
          const on = option.key === selected;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                onPick(option.key);
                sheet.dismiss();
              }}
              android_ripple={{ color: surface.pinkRow }}
              style={({ pressed }) => [
                styles.option,
                on ? styles.optionSelected : null,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[type.button, styles.optionLabel, on ? styles.pink : null]}>
                {option.label.toUpperCase()}
              </Text>
              {option.count ? (
                <Text style={[type.tabLabel, styles.optionCount]}>{option.count}</Text>
              ) : null}
              {on ? <Icon name="check" color={color.pink} size={18} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 14,
    paddingBottom: space.sm,
  },
  slab: {
    borderRadius: radius.card,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
    overflow: 'hidden',
  },
  tabs: {
    paddingHorizontal: 6,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 11,
  },
  tabDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  tabLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.9,
    includeFontPadding: false,
  },
  tabCount: {
    color: color.dim,
  },
  tabRule: {
    position: 'absolute',
    left: 9,
    right: 9,
    bottom: 0,
    height: 2,
    borderRadius: 2,
  },
  cells: {
    flexDirection: 'row',
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 46,
    paddingLeft: space.lg,
    paddingRight: space.md,
  },
  cellRule: {
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  cellCaption: {
    color: color.dim,
  },
  cellValue: {
    flex: 1,
    color: color.fg,
  },
  timelineSkeleton: {
    height: 150,
    borderRadius: radius.cardSm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingTop: layout.blockGap,
    paddingBottom: space.xs,
  },
  headingLabel: {
    color: color.fg,
  },
  headingMeta: {
    color: color.dim,
  },
  footer: {
    paddingVertical: space.xl,
  },
  options: {
    gap: space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  optionSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  optionLabel: {
    flex: 1,
    color: color.fg,
  },
  optionCount: {
    color: color.dim,
  },
  pink: {
    color: color.pink,
  },
});
