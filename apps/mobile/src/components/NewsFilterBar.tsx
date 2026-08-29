import { KIND_LABELS } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { WINDOWS, everyKind, useWindowCounts, type WindowKey } from '../lib/news-filters';
import { duration } from '../lib/motion';
import { Icon, type IconName } from './Icon';
import { color, layout, nativeSurface, radius, space, surface, text } from '../theme/tokens';
import { font, type } from '../theme/typography';

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
 * ALL KINDS is a row of its own rather than every other row ticked. Picking a
 * kind drops it; unticking the last kind returns to it.
 *
 * A kind selection is a *draft* while the menu is open, so picking three kinds
 * is one request rather than three feeds reshuffling under the finger. The
 * draft commits when the menu closes, or after {@link KINDS_SETTLE_MS} of not
 * being touched, whichever comes first.
 */
export function NewsFilterBar({
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
  // One menu at a time: both are anchored to the same row.
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
        // and six filled rows says nothing about which ones are on.
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
 * What the kinds pill says. Only a single kind is named — "ANIME + MANGA"
 * beside the date pill leaves no room for the story count on the same row.
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
 * The open/closed animation the pill and its menu share. `mounted` lags `open`
 * so the exit animation has time to play before `Modal` unmounts the panel.
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
    panelStyle: useAnimatedStyle(() => ({
      opacity: progress.value,
      transform: [{ translateY: (1 - progress.value) * -8 }],
    })),
    caretStyle: useAnimatedStyle(() => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    })),
  };
}

/** The 44pt floor is met with `hitSlop` here: the mockup fixes the pill's padding at 8pt. */
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
      <Text style={[type.eyebrow, text.muted]}>{label.toUpperCase()}</Text>
      <Animated.View style={caretStyle}>
        <Icon name="caret-down" color={color.muted} size={12} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * A menu's rows, floating under the pill row in a `Modal` — a menu has to be
 * dismissable by tapping *away* from it, and the list header cannot hear a tap
 * that lands on the feed (an absolutely positioned child that extends past its
 * parent gets no touches on Android). The modal also gives the hardware back
 * button something to close.
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
            <Text style={[type.eyebrow, styles.filterOptionLabel, row.selected ? text.pink : null]}>
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

const styles = StyleSheet.create({
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
    // The sheet fill, not glass: a translucent panel over news cards is
    // unreadable (§05's rule for sheets, for the same reason).
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
});
