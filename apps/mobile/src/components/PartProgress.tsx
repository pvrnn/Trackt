import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import type { LayoutChangeEvent } from 'react-native';
import { commitHaptic } from '../lib/haptics';
import { PRISM, color, layout, radius, space, surface } from '../theme/tokens';
import { Icon } from './Icon';
import { PrismText } from './PrismText';
import { type } from '../theme/typography';

/**
 * "I'm on chapter 120 of 900" — the parts control for a long work.
 *
 * Past 30 parts (`usesProgressSlider`) the tile grid stops being a checklist
 * and becomes a wall: nobody catches a 900-chapter manga up one tap at a time,
 * and what they actually know is a *position*. Two ways to state one here, both
 * sending a single `setProgress` write: type the number, or drag to it.
 *
 * The number is a `TextInput`, not a label — it is the readout *and* the field,
 * so correcting it costs a tap and reveals nothing. It is also the accessible
 * path: a pan has nothing to offer VoiceOver or switch control, which is the
 * same reason `SwipeCheckIn` keeps its button. The track answers the adjustable
 * actions on top of that, so an assistive user can nudge it a part at a time.
 *
 * Hand-rolled on `Gesture.Pan` rather than a slider dependency, for the reason
 * `RatingSheet`'s scrubber already is: the pattern is fifteen lines, and a new
 * native module costs a dev-client rebuild and an expo-doctor check.
 *
 * The drag is **local state committed on release**. Every step of a 900-part
 * drag would otherwise be a write, and — because this sits in the media
 * screen's list header — a re-render of the grid underneath it.
 */
export function PartProgress({
  noun,
  total,
  position,
  watchedCount,
  doneLabel,
  onCommit,
}: {
  /** 'Episode' / 'Chapter', per kind. */
  noun: string;
  total: number;
  /** The highest part with everything before it checked in. */
  position: number;
  /**
   * How many parts are ticked in all. Not printed — "175 OF 380" already says
   * it whenever progress is contiguous. It is here for the one case where the
   * two disagree: a sparse log, where the note below has to warn what a drag is
   * about to clear.
   */
  watchedCount: number;
  /** 'Watched' or 'Read'. */
  doneLabel: string;
  onCommit: (upTo: number) => void;
}) {
  // Drafts, not synced state: the parent keys this component by `position`, so
  // a position that moves under it — a queued write landing, a status sweep,
  // the server correcting an optimistic patch — remounts with fresh drafts.
  // That is the one reset React documents for exactly this, and it is why
  // there is no effect here mirroring a prop into state.
  const [value, setValue] = useState(position);
  const [field, setField] = useState(String(position));
  // The readout is PRISM-gradient text (web's `.text-prism`, the same treatment
  // the rating and status wear), and a gradient cannot be painted *into* a
  // `TextInput` — RN has no `background-clip: text`. So the number is the
  // gradient until it is tapped, and a field while it is being edited.
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
   * This control sits in the media screen's list header, and a pan with
   * `minDistance(0)` (what `RatingSheet`'s scrubber inside a sheet can afford)
   * wins the touch the instant a finger lands, so a scroll that happens to
   * start on the track would move the position instead of the page. Requiring
   * horizontal travel to activate, and failing on vertical, hands that gesture
   * back to the list — while the tap keeps "put me at roughly here" working.
   */
  const tap = Gesture.Tap().onEnd((event) => {
    scrub(event.x);
    runOnJS(commit)(dragged.value);
  });

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-10, 10])
    // The track is 6pt tall; without the slop it is a hairline to anything but
    // a fingertip landing exactly on it.
    .hitSlop({ vertical: 16 })
    .onUpdate((event) => scrub(event.x))
    .onEnd(() => {
      runOnJS(commit)(dragged.value);
    })
    .onFinalize((_event, success) => {
      // A cancelled drag has already moved the readout; nothing was sent, so
      // it goes back to where the viewer actually is.
      if (!success) runOnJS(setValue)(position);
    });

  const gesture = Gesture.Race(tap, pan);

  const percent = total > 0 ? (value / total) * 100 : 0;
  const plural = `${noun.toUpperCase()}S`;
  const ahead = watchedCount - value;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.position}>
          {editing ? (
            <TextInput
              value={field}
              onChangeText={(text) => setField(text.replace(/[^0-9]/g, ''))}
              onBlur={() => {
                setEditing(false);
                submitField();
              }}
              onSubmitEditing={() => {
                setEditing(false);
                submitField();
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              maxLength={5}
              accessibilityLabel={`${noun} you're on`}
              style={[styles.number, styles.field, styles.fieldText]}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${noun} you're on: ${value}. Tap to edit`}
              onPress={() => {
                setField(String(value));
                setEditing(true);
              }}
              style={styles.field}
            >
              {/* Shrink-to-fit, or the mask stretches the gradient with it. */}
              <View style={styles.shrink}>
                <PrismText style={styles.number}>{String(value)}</PrismText>
              </View>
            </Pressable>
          )}
          <Text style={[type.label, styles.dim]}>
            OF {total} {plural}
          </Text>
        </View>
        {/* The one-more button — dragging a 900-part slider by a single step
            is a fiddle, and "I read one more" is the commonest thing anyone
            opens this card to say. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${doneLabel} one more ${noun.toLowerCase()}`}
          accessibilityState={{ disabled: value >= total }}
          disabled={value >= total}
          onPress={() => commit(value + 1)}
          android_ripple={{ color: surface.pinkRow }}
          style={({ pressed }) => [
            styles.plusOne,
            value >= total ? styles.plusOneInert : null,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon name="plus" color={value >= total ? color.faint : color.pink} size={18} />
        </Pressable>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={`${plural.toLowerCase()} ${doneLabel.toLowerCase()}`}
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
          {/* A soft pink halo under the knob: at 8pt the rail alone reads as a
              progress bar, and a progress bar does not look draggable. */}
          <View style={[styles.halo, { left: `${percent}%` }]} />
          <View style={[styles.thumb, { left: `${percent}%` }]} />
        </View>
      </GestureDetector>

      {ahead > 0 ? (
        <Text style={[type.bodySm, styles.muted]}>
          {ahead} {noun.toLowerCase()}
          {ahead === 1 ? ' is' : 's are'} ticked further ahead — moving the slider clears anything
          past where you are.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  position: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  field: {
    minWidth: 64,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  // 44pt of touch around a 6pt track: the row is the target, not the hairline.
  track: {
    height: layout.touchTarget,
    justifyContent: 'center',
  },
  rail: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: surface.glassBorderStrong,
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  halo: {
    position: 'absolute',
    top: '50%',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    backgroundColor: surface.pinkRow,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: color.pink,
    backgroundColor: color.ink,
  },
  plusOne: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.pink,
  },
  plusOneInert: {
    borderColor: surface.glassBorder,
  },
  pink: {
    color: color.pink,
  },
  /** A step above the unit beside it, not a hero stat: `type.stat` at 26 next
      to 11px caps was two scales sharing a line. */
  number: { ...type.stat, fontSize: 22, lineHeight: 24 },
  fieldText: {
    color: color.pink,
    textAlign: 'center',
  },
  shrink: {
    alignSelf: 'center',
  },
  dim: {
    color: color.dim,
  },
  faint: {
    color: color.faint,
  },
  muted: {
    color: color.muted,
  },
});
