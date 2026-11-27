import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { commitHaptic, selectionHaptic } from '../lib/haptics';
import {
  PRISM,
  color,
  control,
  nativeInk,
  nativeSurface,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../theme/tokens';
import { font, type, displayLine } from '../theme/typography';
import { Icon } from './Icon';
import { AnimatedPressable, ripple, usePressMotion } from './Press';
import { PrismText } from './PrismText';

/**
 * The screen's one primary — the next unit, "WATCH E5" — and under it the two
 * state buttons side by side: where the log stands, and whether it is a
 * favourite (`Mobile App.dc.html` §MEDIA DETAIL).
 */
export function MediaActions({
  label,
  caughtUp,
  statusLabel,
  favorited,
  onPrimary,
  onEditStatus,
  onToggleFavorite,
}: {
  /** 'READ CH 113' / 'WATCH E4' / 'CAUGHT UP' — already in caps. */
  label: string;
  /** Nothing left to check in: the button stops being the PRISM one. */
  caughtUp: boolean;
  /** 'IN PROGRESS', or null when nothing is logged. */
  statusLabel: string | null;
  favorited: boolean;
  onPrimary: () => void;
  onEditStatus: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useTranslation();
  const press = usePressMotion();

  return (
    <View style={styles.actions}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label.toLowerCase()}
        onPress={onPrimary}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        android_ripple={ripple(true)}
        style={[styles.primary, press.animatedStyle]}
      >
        {/* Painted by a child, never by the Pressable: `android_ripple` swaps
            the view's own background drawable. */}
        {caughtUp ? (
          <View style={[styles.primaryInner, styles.primaryDone]}>
            <Icon name="star-filled" color={color.muted} size={15} />
            <Text style={[type.button, text.muted]}>{label}</Text>
          </View>
        ) : (
          <LinearGradient
            colors={[...PRISM]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryInner}
          >
            <Icon name="check" color={color.onPrism} size={16} />
            <Text style={[type.button, text.onPrism]} numberOfLines={1}>
              {label}
            </Text>
          </LinearGradient>
        )}
      </AnimatedPressable>

      <View style={styles.pair}>
        <StateButton
          active={statusLabel !== null}
          label={
            statusLabel
              ? t('media.hero.statusChange', { status: statusLabel.toLowerCase() })
              : t('media.hero.addToLog')
          }
          onPress={onEditStatus}
        >
          {statusLabel ? (
            <View style={styles.statusDot} />
          ) : (
            <Icon name="plus" color={color.fg} size={14} />
          )}
          <Text style={[styles.stateText, statusLabel ? text.pinkInk : text.fg]} numberOfLines={1}>
            {statusLabel ?? t('media.hero.addToLogLabel')}
          </Text>
          <Icon name="caret-down" color={statusLabel ? nativeInk.pinkInk : color.muted} size={12} />
        </StateButton>

        <StateButton
          active={favorited}
          selected={favorited}
          label={
            favorited ? t('media.actions.removeFromFavourites') : t('media.actions.addToFavourites')
          }
          onPress={onToggleFavorite}
        >
          <Icon
            name={favorited ? 'heart-filled' : 'heart'}
            color={favorited ? nativeInk.pinkInk : color.muted}
            size={15}
          />
          <Text style={[styles.stateText, favorited ? text.pinkInk : text.muted]} numberOfLines={1}>
            {favorited ? t('media.favourited') : t('media.favourite')}
          </Text>
        </StateButton>
      </View>
    </View>
  );
}

function StateButton({
  active,
  selected,
  label,
  onPress,
  children,
}: {
  active: boolean;
  selected?: boolean;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(selected !== undefined ? { accessibilityState: { selected } } : {})}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple(true)}
      style={[styles.state, press.animatedStyle]}
    >
      <View style={[styles.stateFace, active && styles.stateActive]}>{children}</View>
    </AnimatedPressable>
  );
}

/** 0–10 in half steps — exactly what `RatingScoreSchema` admits. */
const STEP = 0.5;
const MAX = 10;
const BARS = 10;
const BAR_EMPTY = 'rgba(255,255,255,0.12)';

function hexChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The PRISM gradient sampled at `t` in [0, 1], so each bar wears its own slice. */
function prismAt(t: number): string {
  const segment = t < 0.5 ? 0 : 1;
  const u = segment === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = hexChannels(PRISM[segment]);
  const b = hexChannels(PRISM[segment + 1]!);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * u)).join(',')})`;
}

const BAR_COLORS = Array.from({ length: BARS }, (_, i) => prismAt(i / (BARS - 1)));

/**
 * YOUR LOG: rating, dates, lists — one row each, one action each. The rating is
 * scrubbed in place across ten rising bars and written once, on release;
 * sliding to zero is how a rating comes back off.
 */
export function LogCard({
  score,
  communityScore,
  ratingCount,
  onRate,
  datesLabel,
  onEditDates,
  onAddToList,
}: {
  score: number | null;
  communityScore: number | null;
  ratingCount: number;
  /** `null` clears the rating. */
  onRate: (score: number | null) => void;
  /**
   * '12 JUL → 03 AUG', null for a log with no dates, undefined when nothing is
   * logged — there is no log row to date yet.
   */
  datesLabel?: string | null | undefined;
  onEditDates: () => void;
  onAddToList?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const community =
    communityScore !== null
      ? t('media.rating.community', { score: communityScore.toFixed(1), count: ratingCount })
      : t('media.rating.none');

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('media.log.title').toUpperCase()}</Text>

      <View style={styles.ratingBlock}>
        <Text style={styles.label}>{t('media.rating.yours')}</Text>
        {/* Keyed so a score that moves underneath (a queued write landing)
            resets the draft rather than being mirrored by an effect. */}
        <RatingBars key={score ?? -1} score={score} onCommit={onRate} />
        <Text style={styles.community} numberOfLines={1}>
          {community}
        </Text>
      </View>

      {datesLabel !== undefined ? (
        <LogRow
          label={t('media.log.dates')}
          value={datesLabel}
          action={t('media.log.edit')}
          accessibilityLabel={
            datesLabel
              ? t('media.hero.datesChange', { dates: datesLabel })
              : t('media.hero.setDates')
          }
          onPress={onEditDates}
        />
      ) : null}

      {onAddToList ? (
        <LogRow
          label={t('media.log.lists')}
          value={t('media.log.listsValue')}
          muted
          action={t('media.log.add')}
          accessibilityLabel={t('media.actions.addToList')}
          onPress={onAddToList}
        />
      ) : null}
    </View>
  );
}

function RatingBars({
  score,
  onCommit,
}: {
  score: number | null;
  onCommit: (score: number | null) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(score ?? 0);
  const width = useSharedValue(0);
  const dragged = useSharedValue(score ?? 0);

  const commit = (next: number) => {
    setValue(next);
    if (next === 0) {
      if (score !== null) {
        commitHaptic();
        onCommit(null);
      }
      return;
    }
    if (next !== score) {
      commitHaptic();
      onCommit(next);
    }
  };

  const scrub = (x: number) => {
    'worklet';
    if (width.value <= 0) return;
    const ratio = Math.min(Math.max(x, 0), width.value) / width.value;
    const next = Math.round((ratio * MAX) / STEP) * STEP;
    if (next === dragged.value) return;
    dragged.value = next;
    runOnJS(selectionHaptic)();
    runOnJS(setValue)(next);
  };

  // Raced, and the pan needs horizontal travel to activate: this sits in a
  // scroll view, and a pan that wins on touch would steal every scroll that
  // starts on the bars (the same trap `ProgressCard` documents).
  const tap = Gesture.Tap().onEnd((event) => {
    scrub(event.x);
    runOnJS(commit)(dragged.value);
  });
  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-10, 10])
    .onUpdate((event) => scrub(event.x))
    .onEnd(() => {
      runOnJS(commit)(dragged.value);
    })
    .onFinalize((_event, success) => {
      if (!success) {
        dragged.value = score ?? 0;
        runOnJS(setValue)(score ?? 0);
      }
    });

  const step = (delta: number) => {
    const next = Math.min(MAX, Math.max(0, value + delta));
    dragged.value = next;
    commit(next);
  };

  return (
    <View style={styles.ratingRow}>
      <View style={styles.scoreSlot}>
        {value > 0 ? (
          <PrismText style={styles.score}>{value.toFixed(1)}</PrismText>
        ) : (
          <Icon name="star" color={color.dim} size={30} />
        )}
      </View>
      <GestureDetector gesture={Gesture.Race(tap, pan)}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={t('media.rating.scrub')}
          accessibilityValue={{ min: 0, max: MAX, now: value, text: value.toFixed(1) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') step(STEP);
            if (event.nativeEvent.actionName === 'decrement') step(-STEP);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            width.value = event.nativeEvent.layout.width;
          }}
          style={styles.bars}
        >
          {BAR_COLORS.map((fill, i) => {
            const share = value >= i + 1 ? '100%' : value >= i + STEP ? '50%' : '0%';
            return (
              <View key={i} style={[styles.bar, { height: `${46 + i * 6}%` }]}>
                <View style={[styles.barFill, { width: share, backgroundColor: fill }]} />
              </View>
            );
          })}
        </View>
      </GestureDetector>
    </View>
  );
}

function LogRow({
  label,
  value,
  muted = false,
  action,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  /** Null shows the row's empty state. */
  value: string | null;
  muted?: boolean;
  action: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={{ color: surface.pinkRow }}
      style={({ pressed }) => [styles.logRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.label, styles.rowLabel]}>{label}</Text>
      <Text
        style={[styles.rowValue, muted || value === null ? text.muted : text.fg]}
        numberOfLines={1}
      >
        {value ?? t('media.log.noDates')}
      </Text>
      <Text style={[styles.rowAction, text.pinkInk]}>{action}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: space.md,
  },
  primary: {
    height: control.primary,
  },
  primaryDone: {
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  primaryInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    // The rounding lives here, not on the Pressable: clipping a child to a
    // rounded `overflow: 'hidden'` parent that Reanimated drives leaves it laid
    // out and painting nothing.
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  pair: {
    flexDirection: 'row',
    gap: 10,
  },
  state: {
    flex: 1,
    height: control.secondary,
  },
  stateFace: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    backgroundColor: nativeSurface.row,
  },
  stateActive: {
    borderColor: surface.pinkBorderStrong,
  },
  stateText: {
    ...type.eyebrow,
    flexShrink: 1,
    letterSpacing: 1.1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.pink,
  },
  card: {
    paddingTop: space.lg,
    paddingHorizontal: 18,
    paddingBottom: space.xs,
    borderRadius: radius.card,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  cardTitle: {
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: displayLine(20),
    color: color.fg,
    marginBottom: 14,
  },
  ratingBlock: {
    gap: 10,
    paddingBottom: space.lg,
  },
  label: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.dim,
    includeFontPadding: false,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
  },
  /** Wide enough for '10.0', so the bars never shift. */
  scoreSlot: {
    width: 64,
    height: 40,
    justifyContent: 'flex-end',
  },
  score: {
    fontFamily: font.display,
    fontSize: 42,
    lineHeight: displayLine(42),
  },
  bars: {
    flex: 1,
    height: control.inRow,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    flex: 1,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: BAR_EMPTY,
  },
  barFill: {
    height: '100%',
  },
  community: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.6,
    color: color.muted,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 50,
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  rowLabel: {
    width: 54,
  },
  rowValue: {
    flex: 1,
    fontFamily: font.bodySemibold,
    fontSize: 14,
  },
  rowAction: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
  },
});
