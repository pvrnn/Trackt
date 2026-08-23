import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import type { LayoutChangeEvent } from 'react-native';
import { selectionHaptic } from '../lib/haptics';
import { PRISM, color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';
import { PrismButton } from './PrismButton';
import { PrismText } from './PrismText';
import { Sheet, useSheetController } from './Sheet';

/** 0–10 in half steps — exactly what `RatingScoreSchema` admits. */
const STEP = 0.5;
const MAX = 10;

/**
 * The score picker (`PUT|DELETE /media/:id/rating`), drawn from the rate sheet
 * in `docs/design/Mobile App.dc.html`: the number in PRISM at 40, what is being
 * rated beside it, one slider, and SAVE next to a round dismiss.
 *
 * It replaces a readout of ten stars over a scrolling row of 21 chips. The
 * stars were there because web's half-star targets are 12px and this app does
 * not break the 44pt minimum, and the chips were there because a pan is not
 * something switch control can perform. The slider answers both: the whole
 * 0–10 range is one gesture, and the track carries `accessibilityRole
 * "adjustable"` with increment/decrement actions, which is the platform's own
 * accessible slider — a half step per action, the same half steps the schema
 * allows.
 *
 * Unlike the other action sheets this one does not commit on touch: every
 * intermediate value of a scrub would otherwise be a PUT. SAVE commits, the
 * cross dismisses, and the sheet opens on the current score.
 */
export function RatingSheet({
  score,
  mediaTitle,
  onSave,
  onClose,
}: {
  score: number | null;
  mediaTitle: string;
  /** `null` clears the rating. */
  onSave: (score: number | null) => void;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const [draft, setDraft] = useState<number>(score ?? 0);

  const commit = (next: number | null) => {
    onSave(next);
    sheet.dismiss();
  };

  return (
    <Sheet title="Rate this" controller={sheet}>
      <View style={styles.readout}>
        <PrismText style={styles.score}>{draft.toFixed(1)}</PrismText>
        <Text style={styles.caption} numberOfLines={1}>
          {mediaTitle.toUpperCase()}
        </Text>
      </View>

      <ScoreSlider value={draft} onChange={setDraft} />

      <View style={styles.actions}>
        <PrismButton label="Save" onPress={() => commit(draft)} style={styles.save} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          onPress={sheet.dismiss}
          android_ripple={{ color: surface.pinkRow }}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Icon name="close" color={color.muted} size={18} />
        </Pressable>
      </View>

      {/* Not in the mockup, and it cannot be left out: this sheet is the only
          place a rating can be taken back off a title. Quiet, and only once
          there is something to clear. */}
      {score !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear your rating"
          onPress={() => commit(null)}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[type.eyebrow, styles.dim]}>CLEAR RATING</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

/**
 * The scrub: a 4pt rail with a PRISM fill and the design's solid light knob.
 *
 * A tap and a pan raced, for the reason `ProgressCard`'s slider gives — except
 * here the sheet does not scroll, so the pan may activate on touch and a single
 * tap can land a score directly. Each half step it crosses ticks (§07's
 * threshold haptic); nothing is written until SAVE.
 */
function ScoreSlider({ value, onChange }: { value: number; onChange: (score: number) => void }) {
  const trackWidth = useSharedValue(0);
  const lastStep = useSharedValue(-1);

  const scrub = (x: number) => {
    'worklet';
    if (trackWidth.value <= 0) return;
    const ratio = Math.min(Math.max(x, 0), trackWidth.value) / trackWidth.value;
    const step = Math.round((ratio * MAX) / STEP);
    if (step === lastStep.value) return;
    lastStep.value = step;
    runOnJS(selectionHaptic)();
    runOnJS(onChange)(step * STEP);
  };

  const release = () => {
    'worklet';
    lastStep.value = -1;
  };

  const tap = Gesture.Tap().onEnd((event) => {
    scrub(event.x);
    release();
  });

  const pan = Gesture.Pan()
    .minDistance(0)
    // The rail is 4pt tall; without the slop it is a hairline to anything but a
    // fingertip landing exactly on it.
    .hitSlop({ vertical: 16 })
    .onBegin((event) => scrub(event.x))
    .onUpdate((event) => scrub(event.x))
    .onFinalize(release);

  const percent = (value / MAX) * 100;

  return (
    <GestureDetector gesture={Gesture.Race(tap, pan)}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Your score"
        accessibilityValue={{ min: 0, max: MAX, now: value, text: value.toFixed(1) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            onChange(Math.min(MAX, value + STEP));
          }
          if (event.nativeEvent.actionName === 'decrement') {
            onChange(Math.max(0, value - STEP));
          }
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
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
  },
  /** Anton 40, the mockup's own size for the value being set. */
  score: {
    fontFamily: type.title.fontFamily,
    fontSize: 40,
    lineHeight: 42,
  },
  caption: {
    flex: 1,
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 11,
    letterSpacing: 0.88,
    color: color.dim,
  },
  track: {
    height: layout.touchTarget,
    justifyContent: 'center',
    marginHorizontal: space.sm,
  },
  rail: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: surface.glassBorder,
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  knob: {
    position: 'absolute',
    top: '50%',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    backgroundColor: color.fg,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.md,
  },
  save: {
    flex: 1,
  },
  dismiss: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  clear: {
    alignSelf: 'center',
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  dim: {
    color: color.dim,
  },
});
