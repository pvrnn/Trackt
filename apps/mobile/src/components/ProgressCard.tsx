import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import type { LayoutChangeEvent } from 'react-native';
import { commitHaptic } from '../lib/haptics';
import { PRISM, color, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';

/**
 * The progress control — one block, one shape, every kind of work
 * (`Mobile Media.dc.html` §"ONE CONTROL FOR EVERY KIND"). A movie is this with
 * a total of 1; a 312-chapter webtoon is this with a total of 312. Only the
 * unit label changes.
 *
 * The counter is the source of truth: progress is one integer, not a set of
 * ticked boxes, so there are exactly three ways to move it and all three are
 * the same write —
 *
 * - **type** into the number for a precise jump (you know you are on 187),
 * - **drag** the slider to travel across hundreds in one gesture,
 * - **−/+** for a single unit, which is what most days need.
 *
 * The design's scale, kept: 46 Anton for the number, 24 for `/ total`, a 6pt
 * rail with the PRISM fill and a 26pt light knob, 46pt round steppers with the
 * plus in PRISM. The number is a bare field with an underline that lights pink
 * on focus — no well, no border, because a box around it made it read as a form
 * rather than a readout you can edit.
 */
export function ProgressCard({
  unitLabel,
  total,
  position,
  watchedCount,
  onCommit,
}: {
  /** 'CHAPTERS READ' / 'EPISODES WATCHED' — the unit, already in caps. */
  unitLabel: string;
  total: number;
  /** The highest part with everything before it done: where the viewer is. */
  position: number;
  /**
   * How many parts are ticked in all. Not printed — with contiguous progress it
   * is the position. It is here for the sparse case, where the note below has
   * to say what a move is about to clear.
   */
  watchedCount: number;
  onCommit: (upTo: number) => void;
}) {
  // Drafts, not synced state: the parent keys this component by `position`, so
  // a value that moves under it — a queued write landing, a rolled-back patch —
  // remounts with fresh drafts. That is the reset React documents for this, and
  // it is why there is no effect here mirroring a prop into state.
  const [value, setValue] = useState(position);
  const [field, setField] = useState(String(position));
  const [editing, setEditing] = useState(false);
  const trackWidth = useSharedValue(0);
  // The drag's live step, on the UI thread, so the gesture's end can read what
  // the finger last chose rather than what its closure captured on touch-down.
  const dragged = useSharedValue(position);

  const clamp = (next: number) => Math.min(Math.max(Math.round(next), 0), total);

  const commit = (next: number) => {
    const upTo = clamp(next);
    setValue(upTo);
    setField(String(upTo));
    dragged.value = upTo;
    if (upTo !== position) {
      commitHaptic();
      onCommit(upTo);
    }
  };

  const submitField = () => {
    setEditing(false);
    const parsed = Number.parseInt(field, 10);
    // An empty or unparseable field is a typo, not "clear my progress".
    commit(Number.isNaN(parsed) ? position : parsed);
  };

  const scrub = (x: number) => {
    'worklet';
    if (trackWidth.value <= 0) return;
    const ratio = Math.min(Math.max(x, 0), trackWidth.value) / trackWidth.value;
    const step = Math.round(ratio * total);
    dragged.value = step;
    runOnJS(setValue)(step);
  };

  /**
   * A tap and a horizontal drag, raced — not one pan that activates on touch.
   *
   * This card sits in a scrolling screen, and a pan with `minDistance(0)` (what
   * `RatingSheet`'s scrubber inside a sheet can afford) wins the touch the
   * instant a finger lands, so a scroll that happened to start on the rail
   * would move the position instead of the page. Requiring horizontal travel to
   * activate, and failing on vertical, hands that gesture back to the scroll
   * view — while the tap keeps "put me roughly here" working.
   */
  const tap = Gesture.Tap().onEnd((event) => {
    scrub(event.x);
    runOnJS(commit)(dragged.value);
  });

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-10, 10])
    // The rail is 6pt tall; without the slop it is a hairline to anything but a
    // fingertip landing exactly on it.
    .hitSlop({ vertical: 16 })
    .onUpdate((event) => scrub(event.x))
    .onEnd(() => {
      runOnJS(commit)(dragged.value);
    })
    .onFinalize((_event, success) => {
      // A cancelled drag has already moved the readout; nothing was sent, so it
      // goes back to where the viewer actually is.
      if (!success) runOnJS(setValue)(position);
    });

  const gesture = Gesture.Race(tap, pan);

  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  const ahead = watchedCount - value;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={[type.eyebrow, styles.dim]}>{unitLabel}</Text>
        <Text style={[type.eyebrow, styles.pink]}>{percent}%</Text>
      </View>

      <View style={styles.counter}>
        <View style={styles.readout}>
          {editing ? (
            <TextInput
              value={field}
              onChangeText={(text) => setField(text.replace(/[^0-9]/g, ''))}
              onBlur={submitField}
              onSubmitEditing={submitField}
              keyboardType="number-pad"
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              maxLength={5}
              accessibilityLabel="Where you are"
              style={[styles.number, styles.field, styles.editing]}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Where you are: ${value} of ${total}. Tap to edit`}
              onPress={() => {
                setField(String(value));
                setEditing(true);
              }}
              style={styles.field}
            >
              <Text style={[styles.number, styles.fg]}>{value}</Text>
            </Pressable>
          )}
          <Text style={[styles.total, styles.dim]}>/ {total}</Text>
        </View>

        <View style={styles.steppers}>
          <Stepper
            direction="down"
            disabled={value <= 0}
            label="One fewer"
            onPress={() => commit(value - 1)}
          />
          <Stepper
            direction="up"
            disabled={value >= total}
            label="One more"
            onPress={() => commit(value + 1)}
          />
        </View>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={unitLabel.toLowerCase()}
          accessibilityValue={{ min: 0, max: total, now: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') commit(value + 1);
            if (event.nativeEvent.actionName === 'decrement') commit(value - 1);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            trackWidth.value = event.nativeEvent.layout.width;
          }}
          style={styles.track}
        >
          <View style={styles.rail}>
            <LinearGradient
              colors={[...PRISM]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${percent}%` }]}
            />
          </View>
          <View style={[styles.knob, { left: `${percent}%` }]} />
        </View>
      </GestureDetector>

      {ahead > 0 ? (
        <Text style={[type.bodySm, styles.muted]}>
          {ahead} further ahead {ahead === 1 ? 'is' : 'are'} ticked — moving this clears anything
          past where you are.
        </Text>
      ) : null}
    </View>
  );
}

/** −/+ : 46pt round, the plus in PRISM because it is the one you press daily. */
function Stepper({
  direction,
  disabled,
  label,
  onPress,
}: {
  direction: 'up' | 'down';
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const glyph =
    direction === 'up' ? (
      <Icon name="plus" color={color.onPrism} size={20} />
    ) : (
      <Icon name="minus" color={disabled ? color.faint : color.muted} size={20} />
    );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: surface.pinkRow }}
      style={({ pressed }) => [styles.stepper, { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}
    >
      {/* Both faces are painted by a child, never by the Pressable itself:
          `android_ripple` swaps the view's own background drawable on Android,
          which silently ate the minus's ring and left the glyph floating. */}
      {direction === 'up' ? (
        <LinearGradient
          colors={[...PRISM]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.stepperFace}
        >
          {glyph}
        </LinearGradient>
      ) : (
        <View style={[styles.stepperFace, styles.stepperGlass]}>{glyph}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The one card in the app that wears a pink ring rather than the glass
  // hairline: it is the screen's subject, and the mockup rings it for that.
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.pinkBorder,
    backgroundColor: surface.glass,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  readout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  field: {
    minWidth: 56,
  },
  /** Anton 46: the number is the biggest thing on the screen after the title. */
  number: {
    fontFamily: type.stat.fontFamily,
    fontSize: 46,
    lineHeight: 48,
  },
  editing: {
    color: color.fg,
    borderBottomWidth: 2,
    borderBottomColor: color.pink,
    paddingVertical: 0,
  },
  total: {
    fontFamily: type.stat.fontFamily,
    fontSize: 24,
    lineHeight: 26,
  },
  steppers: {
    flexDirection: 'row',
    gap: space.sm,
  },
  stepper: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A full point, not a hairline: at 3x a 0.33dp ring around a 46pt disc reads
  // as no ring at all.
  stepperGlass: {
    borderWidth: 1,
    borderRadius: radius.pill,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  stepperFace: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    height: 26,
    justifyContent: 'center',
  },
  rail: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: surface.glassBorder,
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  // Light and solid, with the mockup's drop shadow: the one control surface in
  // the app that is not glass, because a knob has to look grabbable.
  knob: {
    position: 'absolute',
    top: '50%',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: 13,
    backgroundColor: color.fg,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fg: {
    color: color.fg,
  },
  dim: {
    color: color.dim,
  },
  muted: {
    color: color.muted,
  },
  pink: {
    color: color.pink,
  },
});
