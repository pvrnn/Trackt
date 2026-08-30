import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration } from '../lib/motion';
import { Icon, type IconName } from './Icon';
import {
  color,
  layout,
  nativeSurface,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../theme/tokens';
import { font, type } from '../theme/typography';

/** One row of a filter menu: what it is called, and what it would show. */
export interface MenuRow {
  key: string;
  label: string;
  count?: string | undefined;
  selected: boolean;
}

/** One pill and the menu behind it. */
export interface Filter {
  key: string;
  icon: IconName;
  /** What the control says when it is closed — the selection, not the axis. */
  label: string;
  /** The axis's own name, shown above the value in the `columns` layout. */
  caption?: string;
  rows: MenuRow[];
  /** `row` fills the selected row; `mark` leaves it to the label and check. */
  highlight?: 'row' | 'mark';
  /** A multi-select menu stays open while rows are picked. */
  stayOpen?: boolean;
  /** Inert but still present, so the axis does not vanish and reflow the row. */
  disabled?: boolean;
  onSelect: (key: string) => void;
  /** Runs when this menu closes — where a drafted selection commits. */
  onClose?: (() => void) | undefined;
}

/**
 * A row of glass controls, each opening a menu of its options, with an optional
 * summary opposite them.
 *
 * Two layouts, because three axes do not fit one line as pills. **`pills`** is
 * the news feed's shape: content-width, an icon and the value, wrapping when it
 * must. **`columns`** divides the line into equal cells that each name their
 * axis above their value — the caption/value pair web's history filters already
 * use. Three pills wrapped 2 + 1, which reads as a mistake rather than a row;
 * three columns cannot wrap at all, and the caption is what lets the value be
 * short enough to fit: "ALL" under KIND says what "ALL KINDS" had to spell out.
 *
 * This is the shape the news feed's kind filter arrived at and the one every
 * filtered screen now uses. The alternative — a scrolling row of chips, one per
 * option — does not survive 362pt: six kinds plus "all" already overflow, and a
 * row that scrolls hides the options nobody scrolled to. A pill says what is
 * selected in the space of one option and puts the rest a tap away, so a screen
 * can carry four axes (History does) where chips could not carry two.
 *
 * The pills wrap. Four of them do not fit on one line, and a filter that has
 * scrolled out of sight is the thing this component exists to avoid.
 */
export function FilterBar({
  filters,
  summary,
  variant = 'pills',
}: {
  filters: Filter[];
  summary?: string | undefined;
  variant?: 'pills' | 'columns';
}) {
  // One menu at a time: they are all anchored to the same row.
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor>({ top: 0, left: 0, width: 0 });
  const row = useRef<View>(null);

  const close = () => {
    const current = filters.find((filter) => filter.key === open);
    current?.onClose?.();
    setOpen(null);
  };

  /** Menus hang off the pill row, so the row is measured in window space. */
  const openMenu = (key: string) => {
    row.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + space.xs, left: x, width });
      setOpen(key);
    });
  };

  return (
    <View style={styles.filter}>
      <View ref={row} style={variant === 'columns' ? styles.filterColumns : styles.filterRow}>
        {filters.map((filter) => (
          <FilterPill
            key={filter.key}
            icon={filter.icon}
            label={filter.label}
            caption={filter.caption}
            variant={variant}
            open={open === filter.key}
            disabled={filter.disabled ?? false}
            onPress={() => (open === filter.key ? close() : openMenu(filter.key))}
          />
        ))}
        {summary ? (
          <Text numberOfLines={1} style={[styles.summary, styles.summaryEnd]}>
            {summary.toUpperCase()}
          </Text>
        ) : null}
      </View>
      {filters.map((filter) => (
        <FilterMenu
          key={filter.key}
          open={open === filter.key}
          anchor={anchor}
          rows={filter.rows}
          highlight={filter.highlight ?? 'row'}
          onSelect={(key) => {
            filter.onSelect(key);
            if (!filter.stayOpen) setOpen(null);
          }}
          onClose={close}
        />
      ))}
    </View>
  );
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
 *
 * `commit`, not `micro`. §07 files a panel presenting and dismissing under the
 * same 220 as a sheet; `micro`'s 140 is for press states and chip selection,
 * and at that speed picking a kind made the whole menu vanish before the eye
 * had followed the tap to the row it landed on.
 */
function useDisclosure(open: boolean) {
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  const [was, setWas] = useState(open);
  // Read by the animation's completion, which lands on the JS thread some time
  // after the worklet finished and must not act on what `open` was back then.
  // Written in the effect below, which commits well before that callback can.
  const latest = useRef(open);

  // Adjusted during render rather than in an effect: the menu has to exist on
  // the frame it starts opening, and an effect would mount it one frame late.
  if (open !== was) {
    setWas(open);
    if (open) setMounted(true);
  }

  /**
   * Unmount the panel, unless it has been reopened in the meantime.
   *
   * The check has to happen *here*, when this runs, rather than in the worklet
   * that scheduled it. A closing animation completes with `finished: true` and
   * hops to the JS thread to unmount; if the pill was tapped again in that
   * gap, the callback still closes over `open: false` and takes down the panel
   * that is now open — a menu whose caret rotates and whose body never
   * appears. `latest` is what `open` is now, not what it was.
   */
  const settle = useCallback(() => {
    if (!latest.current) setMounted(false);
  }, []);

  useEffect(() => {
    latest.current = open;
    progress.value = withTiming(open ? 1 : 0, { duration: duration.commit }, (finished) => {
      if (finished) runOnJS(settle)();
    });
  }, [open, progress, settle]);

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
  caption,
  variant,
  open,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  caption?: string | undefined;
  variant: 'pills' | 'columns';
  open: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { caretStyle } = useDisclosure(open);
  const ink = disabled ? color.faint : color.muted;

  if (variant === 'columns') {
    return (
      <Pressable
        accessibilityRole="button"
        // The caption is the axis; without it the row is three values with no
        // way to tell which "ALL" is which.
        accessibilityLabel={caption ? `${caption}: ${label}` : label}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.filterCell,
          { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        ]}
      >
        {caption ? (
          <Text numberOfLines={1} style={[type.tabLabel, styles.filterCaption]}>
            {caption.toUpperCase()}
          </Text>
        ) : null}
        <View style={styles.filterValueRow}>
          <Text numberOfLines={1} style={[type.tabLabel, styles.filterValue, { color: ink }]}>
            {label.toUpperCase()}
          </Text>
          <Animated.View style={caretStyle}>
            <Icon name="caret-down" color={ink} size={11} />
          </Animated.View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open, disabled }}
      disabled={disabled}
      hitSlop={{ top: space.sm, bottom: space.sm }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterPill, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} color={ink} size={13} />
      <Text style={[type.eyebrow, { color: ink }]}>{label.toUpperCase()}</Text>
      <Animated.View style={caretStyle}>
        <Icon name="caret-down" color={ink} size={12} />
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
  highlight,
  onSelect,
  onClose,
}: {
  open: boolean;
  anchor: Anchor;
  rows: MenuRow[];
  highlight: 'row' | 'mark';
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
    flexWrap: 'wrap',
    gap: space.sm,
  },
  filterColumns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
  },
  /**
   * An equal share of the line — `flex: 1` rather than a content width, so the
   * three read as one control divided three ways and the row cannot wrap. The
   * values are single-line; callers keep them short enough never to reach the
   * cap, and the menu below carries the full wording either way.
   */
  filterCell: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
    minHeight: layout.touchTarget,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  filterCaption: {
    color: color.faint,
    fontSize: 9,
    letterSpacing: 0.9,
  },
  filterValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  filterValue: {
    flexShrink: 1,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: stroke,
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
    // Right of whatever line it lands on, without a spacer that would break the
    // wrap it shares with the pills.
    marginLeft: 'auto',
  },
  filterMenu: {
    position: 'absolute',
    // The sheet fill, not glass: a translucent panel over content is
    // unreadable (§05's rule for sheets, for the same reason).
    backgroundColor: nativeSurface.sheet,
  },
  filterPanel: {
    gap: 2,
    padding: 6,
    borderRadius: radius.cover,
    borderWidth: stroke,
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
