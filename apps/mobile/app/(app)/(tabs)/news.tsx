import { FlashList } from '@shopify/flash-list';
import { KIND_LABELS, TOPIC_LABELS, formatNewsDate, todayIso, useNewsFeed } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind, type NewsArticleSummary } from '@trackt/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { duration } from '../../../src/lib/motion';
import { Cover } from '../../../src/components/Cover';
import { Icon, type IconName } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  StaleNotice,
  useTabContentInset,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import {
  color,
  gutter,
  layout,
  nativeSurface,
  radius,
  space,
  surface,
  text,
} from '../../../src/theme/tokens';
import { font, type } from '../../../src/theme/typography';

/** The mockup's date filter, as the four windows it actually offers. */
const WINDOWS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'all', label: 'All time', days: null },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

/** `days` before today, as the ISO date the feed's `from` bound takes. */
function windowStart(days: number): string {
  const today = todayIso();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

/**
 * The story count each window would show, as the panel prints it
 * (`Mobile App.dc.html`, NEWS). The mockup counts its eight fixture stories in
 * memory; the feed is keyset-paginated and returns no totals, so the counts
 * come from the *unbounded* feed for the current kind — the same query key the
 * ALL TIME window uses, so selecting it costs no extra request.
 *
 * A count is exact when the loaded prefix already reaches past that window's
 * start (or the feed has ended); otherwise it is a floor and is printed with a
 * `+`. Stories are ordered newest-first, so a window's stories are always
 * inside the prefix — only ALL TIME routinely carries the `+`.
 */
function useWindowCounts(kinds: MediaKind[]): Record<WindowKey, string> {
  const { articles, hasMore } = useNewsFeed({ kinds: kindsFilter(kinds) });

  return useMemo(() => {
    const oldest = articles.at(-1)?.publishedAt.slice(0, 10);
    const counts = {} as Record<WindowKey, string>;
    for (const entry of WINDOWS) {
      if (entry.days === null) {
        counts[entry.key] = storyCount(articles.length, hasMore);
        continue;
      }
      const start = windowStart(entry.days);
      const inWindow = articles.filter((article) => article.publishedAt.slice(0, 10) >= start);
      const partial = hasMore && !(oldest !== undefined && oldest < start);
      counts[entry.key] = storyCount(inWindow.length, partial);
    }
    return counts;
  }, [articles, hasMore]);
}

/**
 * The selection as the feed takes it: ALL KINDS is the *absence* of a filter,
 * which is a shorter query and shares its cache entry with the feed a reader
 * who never opened the menu is already looking at. Ticking every kind one by
 * one lands in the same place — {@link everyKind} collapses it on the way in.
 */
function kindsFilter(kinds: MediaKind[]): MediaKind[] {
  return everyKind(kinds) ? [] : kinds;
}

/** True for ALL KINDS, and for the hand-assembled equivalent. */
function everyKind(kinds: MediaKind[]): boolean {
  return kinds.length === 0 || kinds.length === MEDIA_KINDS.length;
}

/** "8 STORIES", or "20+ STORIES" when the feed has pages nobody has asked for. */
function storyCount(n: number, partial: boolean): string {
  const noun = n === 1 && !partial ? 'story' : 'stories';
  return `${n}${partial ? '+' : ''} ${noun}`;
}

/**
 * The news feed (`GET /news`, ADR-0005) — one column, not the four-column
 * masonry of `News.dc.html`. Masonry does not survive 362pt: two columns of
 * 171pt cards leave no room for a headline, and packing shortest-column-first
 * only means something when there is more than one column to balance.
 *
 * Keyset pages append as you reach the end, which is what the cursor contract
 * is shaped for — there is no page count to render, and no way back.
 */
export default function NewsTab() {
  /** Empty is ALL KINDS: its own row in the menu, not every other row ticked. */
  const [kinds, setKinds] = useState<MediaKind[]>([]);
  const [window, setWindow] = useState<WindowKey>('all');
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();

  const filters = useMemo(() => {
    const days = WINDOWS.find((entry) => entry.key === window)?.days ?? null;
    return { kinds: kindsFilter(kinds), ...(days === null ? {} : { from: windowStart(days) }) };
  }, [kinds, window]);

  const {
    articles,
    updatedAt,
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
    isRefreshing,
  } = useNewsFeed(filters);

  return (
    <PageFrame fadeOnFocus>
      <FlashList
        data={articles}
        keyExtractor={(article) => article.id}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={color.pink}
            colors={[color.pink]}
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.lg }}>
            <View style={gutter}>
              {/* No gradient eyebrow: the mockup's is "N UPDATES FROM YOUR
                  LIBRARY", which the feed cannot answer — `NewsArticleSummary`
                  carries no tracking state — and the story count it used to
                  hold now sits opposite the filter pill, where the design puts
                  it. Printing the same count twice, 100pt apart, reads as a
                  bug. */}
              <PageTitle title="News" />
              <StaleNotice updatedAt={updatedAt} />
            </View>
            <View style={styles.secondRow}>
              <NewsFilterBar
                kinds={kinds}
                onKinds={setKinds}
                window={window}
                onWindow={setWindow}
                summary={
                  // "0 STORIES" rather than the mockup's "NOTHING IN THIS
                  // FILTER": that line was written beside a single pill, and
                  // two pills plus a sentence do not fit 362pt.
                  isLoading ? undefined : storyCount(articles.length, hasMore)
                }
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={gutter}>
            {isLoading ? (
              <OfflineFallback>
                <Loading />
              </OfflineFallback>
            ) : isError ? (
              <EmptyState
                title="News is offline"
                body="This instance couldn't reach the catalog's news feed."
              />
            ) : (
              <EmptyState
                title="Nothing yet"
                body={
                  kinds.length > 0 || window !== 'all'
                    ? 'No stories in this filter. Widen the kinds or the date range.'
                    : 'No stories have been published to this instance yet.'
                }
              />
            )}
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <ActivityIndicator color={color.pink} style={styles.footer} />
          ) : articles.length > 0 && !hasMore ? (
            <Text style={[type.eyebrow, styles.end]}>END OF THE FEED</Text>
          ) : null
        }
        renderItem={({ item }) => <NewsRow article={item} />}
      />
    </PageFrame>
  );
}

/** One row of a filter menu: what it is called, and what it would show. */
interface MenuRow {
  key: string;
  label: string;
  count?: string | undefined;
  selected: boolean;
}

/** How long an unfinished kind selection sits before the feed refetches. */
const KINDS_SETTLE_MS = 5000;

/**
 * The filter bar: two glass pills that open menus, and the story count opposite
 * them.
 *
 * The kind filter was the mockup's underline tabs, and tabs do not survive the
 * screen — six kinds plus ALL already overflow 362pt, video games would make it
 * seven, and a row that scrolls hides the options nobody has scrolled to. They
 * are also single-select by construction, and "anime and manga" is one feed a
 * reader wants, not two they have to alternate between. A menu holds any number
 * of kinds at a fixed width and can carry a multi-selection; the pill says what
 * that selection is.
 *
 * ALL KINDS is a row of its own rather than every other row ticked: "all" and
 * "one" are the same kind of choice, and a menu that answers "all" by drawing
 * six ticks makes the reader count them to find out what it is filtering by.
 * Picking a kind drops ALL KINDS; unticking the last kind returns to it.
 *
 * A kind selection is a *draft* while the menu is open. Every tap would
 * otherwise be a network round trip and a feed that reshuffles under the finger
 * — picking three kinds would fetch three feeds, two of which nobody asked to
 * see. The draft commits when the menu closes, or after
 * {@link KINDS_SETTLE_MS} of not being touched, whichever comes first. The pill
 * follows the draft, so the tap still has an immediate answer.
 */
function NewsFilterBar({
  kinds,
  onKinds,
  window,
  onWindow,
  summary,
}: {
  kinds: MediaKind[];
  onKinds: (kinds: MediaKind[]) => void;
  window: WindowKey;
  onWindow: (key: WindowKey) => void;
  summary?: string | undefined;
}) {
  // One menu at a time: both are anchored to the same row, and two panels open
  // over each other is not a state either of them is drawn for.
  const [menu, setMenu] = useState<'kinds' | 'window' | null>(null);
  const [anchor, setAnchor] = useState<Anchor>({ top: 0, left: 0, width: 0 });
  const [draft, setDraft] = useState<MediaKind[]>(kinds);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const row = useRef<View>(null);
  const counts = useWindowCounts(kinds);
  const current = WINDOWS.find((entry) => entry.key === window) ?? WINDOWS[3];

  useEffect(() => () => clearTimeout(settle.current ?? undefined), []);

  const commit = (next: MediaKind[]) => {
    clearTimeout(settle.current ?? undefined);
    settle.current = null;
    onKinds(next);
  };

  const toggleKind = (key: string) => {
    const picked =
      key === 'all'
        ? []
        : draft.includes(key as MediaKind)
          ? draft.filter((value) => value !== key)
          : [...draft, key as MediaKind];
    // Ticking the last unticked kind is ALL KINDS said the long way.
    const next = everyKind(picked) ? [] : picked;
    setDraft(next);
    clearTimeout(settle.current ?? undefined);
    settle.current = setTimeout(() => commit(next), KINDS_SETTLE_MS);
  };

  const closeMenu = () => {
    if (menu === 'kinds') commit(draft);
    setMenu(null);
  };

  /** Menus hang off the pill row, so the row is measured in window space. */
  const openMenu = (which: 'kinds' | 'window') => {
    row.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + space.xs, left: x, width });
      setMenu(which);
    });
  };

  const kindRows: MenuRow[] = [
    { key: 'all', label: 'All kinds', selected: draft.length === 0 },
    ...MEDIA_KINDS.map((value) => ({
      key: value,
      label: KIND_LABELS[value],
      selected: draft.includes(value),
    })),
  ];

  const windowRows: MenuRow[] = WINDOWS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: counts[entry.key],
    selected: entry.key === window,
  }));

  return (
    <View style={styles.filter}>
      <View ref={row} style={styles.filterRow}>
        <FilterPill
          icon="list"
          label={kindsLabel(draft)}
          open={menu === 'kinds'}
          onPress={() => (menu === 'kinds' ? closeMenu() : openMenu('kinds'))}
        />
        <FilterPill
          icon="clock"
          label={current.label}
          open={menu === 'window'}
          onPress={() => (menu === 'window' ? closeMenu() : openMenu('window'))}
        />
        <View style={styles.filterSpacer} />
        {summary ? (
          <Text numberOfLines={1} style={[styles.summary, styles.summaryEnd]}>
            {summary.toUpperCase()}
          </Text>
        ) : null}
      </View>
      <FilterMenu
        open={menu === 'kinds'}
        anchor={anchor}
        rows={kindRows}
        // Mark, not fill: a multi-selection routinely has every row selected,
        // and six filled rows is a pink panel that says nothing about which
        // ones are on.
        highlight="mark"
        onSelect={toggleKind}
        onClose={closeMenu}
      />
      <FilterMenu
        open={menu === 'window'}
        anchor={anchor}
        rows={windowRows}
        onSelect={(key) => {
          onWindow(key as WindowKey);
          setMenu(null);
        }}
        onClose={closeMenu}
      />
    </View>
  );
}

/**
 * What the kinds pill says. Only a single kind is named: "ANIME + MANGA" beside
 * the date pill leaves no room for the story count on the same 362pt row, and
 * the count is the one thing on that row that changes with the filter. Past one
 * kind the pill carries the number and the menu below spells out which.
 */
function kindsLabel(kinds: MediaKind[]): string {
  if (everyKind(kinds)) return 'All kinds';
  const only = kinds[0];
  if (kinds.length === 1 && only) return KIND_LABELS[only];
  return `${kinds.length} kinds`;
}

/** Where a menu hangs: window coordinates of the row it belongs to. */
interface Anchor {
  top: number;
  left: number;
  width: number;
}

/**
 * The open/closed animation the pill and its menu share — §07's micro duration.
 * `mounted` lags `open` by that duration so the caller can keep a menu on
 * screen long enough to play its exit; without it `Modal` would unmount the
 * panel on the same frame the reader dismissed it.
 */
function useDisclosure(open: boolean) {
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  const [was, setWas] = useState(open);

  // Adjusted during render rather than in an effect: the menu has to exist on
  // the frame it starts opening, and an effect would mount it one frame late.
  if (open !== was) {
    setWas(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: duration.micro }, (finished) => {
      if (finished && !open) runOnJS(setMounted)(false);
    });
  }, [open, progress]);

  return {
    mounted,
    /** Down 8pt and transparent, to resting — a menu arriving from its pill. */
    panelStyle: useAnimatedStyle(() => ({
      opacity: progress.value,
      transform: [{ translateY: (1 - progress.value) * -8 }],
    })),
    caretStyle: useAnimatedStyle(() => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    })),
  };
}

/**
 * The pill is the one place the 44pt floor (Mobile System §01) is met with
 * `hitSlop` rather than height — the mockup fixes its padding at 8pt, and
 * growing it to 44 would push the menu off the design's rhythm.
 */
function FilterPill({
  icon,
  label,
  open,
  onPress,
}: {
  icon: IconName;
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const { caretStyle } = useDisclosure(open);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      hitSlop={{ top: space.sm, bottom: space.sm }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterPill, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} color={color.muted} size={13} />
      <Text style={[type.eyebrow, styles.filterPillLabel]}>{label.toUpperCase()}</Text>
      <Animated.View style={caretStyle}>
        <Icon name="caret-down" color={color.muted} size={12} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * A menu's rows, floating under the pill row in a `Modal`.
 *
 * A modal rather than a panel in the list header, because a menu has to be
 * dismissable by tapping *away* from it, and the header cannot hear a tap that
 * lands on the feed — an absolutely positioned child that extends past its
 * parent's bounds gets no touches on Android. The modal is also what gives the
 * hardware back button something to close.
 */
function FilterMenu({
  open,
  anchor,
  rows,
  highlight = 'row',
  onSelect,
  onClose,
}: {
  open: boolean;
  anchor: Anchor;
  rows: MenuRow[];
  /** `row` fills the selected row; `mark` leaves it to the label and check. */
  highlight?: 'row' | 'mark';
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const { mounted, panelStyle } = useDisclosure(open);

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the filter"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <Animated.View
        style={[
          styles.filterPanel,
          styles.filterMenu,
          { top: anchor.top, left: anchor.left, width: anchor.width },
          panelStyle,
        ]}
      >
        {rows.map((row) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityState={{ selected: row.selected }}
            onPress={() => onSelect(row.key)}
            style={({ pressed }) => [
              styles.filterOption,
              row.selected && highlight === 'row' && styles.filterOptionSelected,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text
              style={[type.eyebrow, styles.filterOptionLabel, row.selected ? styles.tag : null]}
            >
              {row.label.toUpperCase()}
            </Text>
            {row.count ? <Text style={styles.summary}>{row.count.toUpperCase()}</Text> : null}
            {row.selected ? <Icon name="check" color={color.pink} size={14} /> : null}
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

function NewsRow({ article }: { article: NewsArticleSummary }) {
  const kind = article.kinds[0];
  return (
    <Touchable href={`/news/${article.slug}`} style={styles.card}>
      {kind ? (
        <Cover
          kind={kind}
          title={article.title}
          coverUrl={article.coverUrl}
          width={72}
          showTitle={false}
        />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={[type.eyebrow, styles.tag]}>{TOPIC_LABELS[article.topic]}</Text>
          {kind ? <KindDot kind={kind} /> : null}
          <Text style={[type.eyebrow, text.dim]}>{formatNewsDate(article.publishedAt)}</Text>
        </View>
        <Text style={[type.cardTitle, styles.title]} numberOfLines={3}>
          {article.title}
        </Text>
        {article.dek ? (
          <Text style={[type.bodySm, styles.dek]} numberOfLines={3}>
            {article.dek}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  secondRow: {
    marginTop: space.md,
    marginBottom: space.lg,
  },
  filter: {
    paddingHorizontal: layout.gutter,
    gap: space.xs,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  filterSpacer: {
    flex: 1,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  filterPillLabel: {
    color: color.muted,
  },
  /** Space Grotesk 10 / +0.1em, the floor of the scale — counts and totals. */
  summary: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.faint,
  },
  summaryEnd: {
    flexShrink: 1,
    textAlign: 'right',
  },
  filterMenu: {
    position: 'absolute',
    // The sheet fill, not glass: a menu floats over the feed it is filtering,
    // and a translucent panel over news cards is unreadable (§05's rule for
    // sheets, for the same reason).
    backgroundColor: nativeSurface.sheet,
  },
  filterPanel: {
    gap: 2,
    padding: 6,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget,
    paddingHorizontal: space.md,
    borderRadius: space.sm,
  },
  filterOptionSelected: {
    backgroundColor: surface.pinkRow,
  },
  filterOptionLabel: {
    flex: 1,
    color: color.muted,
  },
  card: {
    flexDirection: 'row',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.cardSm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  cardBody: {
    flex: 1,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  tag: {
    color: color.pink,
  },
  title: {
    color: color.fg,
  },
  dek: {
    color: color.muted,
  },
  footer: {
    paddingVertical: space.xl,
  },
  end: {
    color: color.faint,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
