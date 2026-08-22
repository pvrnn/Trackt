import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import type { LayoutChangeEvent } from 'react-native';
import { selectionHaptic } from '../lib/haptics';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';
import { PrismButton } from './PrismButton';
import { PrismText } from './PrismText';
import { Sheet, useSheetController } from './Sheet';

/** 0–10 in half steps: 21 values, exactly what `RatingScoreSchema` admits. */
const SCORES = Array.from({ length: 21 }, (_, i) => i / 2);

/**
 * The score picker (`PUT|DELETE /media/:id/rating`).
 *
 * Web's version is a row of ten stars split into half-star hit targets — 12px
 * wide each, which is a third of the 44pt minimum this app does not break
 * (`Mobile System.dc.html` §01). So the stars stay as the *readout*, showing
 * the selection at a glance, and the input underneath is a scrolling row of the
 * 21 values, each a real target.
 *
 * Phase 4 makes the readout draggable — a pan across the stars scrubs the
 * score, ticking at each half step — and the chips remain, because a pan is not
 * usable with one hand on a 6.7" phone and switch control has nothing to pan.
 * A drag is the fast way to 7.5; the chips are the only way for some people.
 *
 * Unlike the other action sheets this one does not commit on tap: 0.0 through
 * 10.0 is a range you scrub, and every intermediate value would otherwise be a
 * PUT. SAVE commits; the sheet opens on the current score.
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
  const [draft, setDraft] = useState<number | null>(score);

  const commit = (next: number | null) => {
    onSave(next);
    sheet.dismiss();
  };

  return (
    <Sheet title="Your rating" subtitle={mediaTitle} controller={sheet}>
      <View style={styles.readout}>
        <Stars score={draft ?? 0} onScrub={setDraft} />
        <View style={styles.shrink}>
          <PrismText style={type.title}>{(draft ?? 0).toFixed(1)}</PrismText>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scores}
      >
        {SCORES.map((value) => {
          const selected = draft === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Rate ${value.toFixed(1)}`}
              accessibilityState={{ selected }}
              onPress={() => {
                selectionHaptic();
                setDraft(value);
              }}
              style={({ pressed }) => [
                styles.score,
                selected ? styles.scoreSelected : null,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[type.label, selected ? styles.pink : styles.dim]}>
                {value.toFixed(1)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <PrismButton
          label={score === null ? 'No rating' : 'Clear rating'}
          variant="secondary"
          disabled={score === null}
          onPress={() => commit(null)}
          style={styles.action}
        />
        <PrismButton
          label="Save"
          disabled={draft === null}
          onPress={() => commit(draft)}
          style={styles.action}
        />
      </View>
    </Sheet>
  );
}

const STAR_SIZE = 20;

/**
 * Ten stars, filled to the score, and — from phase 4 — the scrubber.
 *
 * A half step is a filled star clipped to half its width over an outline one:
 * the same construction web uses, because there is no half-star mark to draw —
 * and the stars themselves are `Icon` paths, since the ☆/★ characters render
 * at a different weight per platform, when the loaded faces have them at all.
 *
 * The pan reads an absolute position rather than a translation, so putting a
 * finger down at 7.5 selects 7.5 — a relative drag would need the user to know
 * where they started, which on a readout they may be seeing for the first time
 * they do not. `minDistance(0)` is what makes a tap on a star work as well as
 * a drag across them; each half step it crosses ticks (§07's threshold haptic).
 *
 * Still hidden from assistive tech: the value is announced by the chips and
 * printed beside them, and a screen reader hearing "star star star" would be
 * all this adds.
 */
function Stars({ score, onScrub }: { score: number; onScrub: (score: number) => void }) {
  const trackWidth = useSharedValue(0);
  const lastStep = useSharedValue(-1);

  const scrub = (x: number) => {
    'worklet';
    if (trackWidth.value <= 0) return;
    const step = Math.round((Math.min(Math.max(x, 0), trackWidth.value) / trackWidth.value) * 20);
    if (step === lastStep.value) return;
    lastStep.value = step;
    runOnJS(selectionHaptic)();
    runOnJS(onScrub)(step / 2);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    // The row is 218 × 24; without the slop the scrubber is a hairline to
    // anything but a fingertip landing exactly on it.
    .hitSlop({ vertical: 14 })
    .onBegin((event) => scrub(event.x))
    .onUpdate((event) => scrub(event.x))
    .onFinalize(() => {
      lastStep.value = -1;
    });

  const onLayout = (event: LayoutChangeEvent) => {
    trackWidth.value = event.nativeEvent.layout.width;
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        onLayout={onLayout}
        style={styles.stars}
      >
        {Array.from({ length: 10 }, (_, i) => {
          const fill = Math.min(Math.max(score - i, 0), 1);
          return (
            <View key={i} style={styles.starSlot}>
              <Icon name="star" color={color.faint} size={STAR_SIZE} />
              {fill > 0 ? (
                <View style={[styles.starFill, { width: STAR_SIZE * fill }]}>
                  <Icon name="star-filled" color={color.pink} size={STAR_SIZE} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
  },
  starSlot: {
    width: STAR_SIZE,
    height: 24,
  },
  starFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  scores: {
    gap: space.sm,
    paddingVertical: space.xs,
  },
  score: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  scoreSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
  },
  action: {
    flex: 1,
  },
  pink: {
    color: color.pink,
  },
  dim: {
    color: color.dim,
  },
});
