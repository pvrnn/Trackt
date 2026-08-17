import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../lib/haptics';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { PrismButton } from './PrismButton';
import { PrismText } from './PrismText';
import { Sheet } from './Sheet';

/** 0–10 in half steps: 21 values, exactly what `RatingScoreSchema` admits. */
const SCORES = Array.from({ length: 21 }, (_, i) => i / 2);

/**
 * The score picker (`PUT|DELETE /media/:id/rating`).
 *
 * Web's version is a row of ten stars split into half-star hit targets — 12px
 * wide each, which is a third of the 44pt minimum this app does not break
 * (`Mobile System.dc.html` §01). So the stars stay as the *readout*, showing
 * the selection at a glance, and the input underneath is a scrolling row of the
 * 21 values, each a real target. Phase 4 adds the pan gesture across the stars
 * that makes the readout draggable; the chips remain, because a pan is not
 * usable with one hand on a 6.7" phone and switch control has nothing to pan.
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
  const [draft, setDraft] = useState<number | null>(score);

  const commit = (next: number | null) => {
    onSave(next);
    onClose();
  };

  return (
    <Sheet title="Your rating" subtitle={mediaTitle} onClose={onClose}>
      <View style={styles.readout}>
        <Stars score={draft ?? 0} />
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
 * Ten stars, filled to the score. A half step is a filled star clipped to half
 * its width over an outline one — the same construction web uses, because no
 * font in the app ships a half-star glyph and the ones that exist in Unicode
 * render as tofu on at least one of the two platforms.
 *
 * Decorative: the value is announced by the chips and printed beside them, so
 * a screen reader hearing "star star star" would be all this adds.
 */
function Stars({ score }: { score: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.stars}>
      {Array.from({ length: 10 }, (_, i) => {
        const fill = Math.min(Math.max(score - i, 0), 1);
        return (
          <View key={i} style={styles.starSlot}>
            <Text style={[styles.star, styles.starEmpty]}>☆</Text>
            {fill > 0 ? (
              <View style={[styles.starFill, { width: STAR_SIZE * fill }]}>
                <Text style={[styles.star, styles.pink]}>★</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
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
  star: {
    width: STAR_SIZE,
    fontSize: STAR_SIZE,
    lineHeight: 24,
  },
  starEmpty: {
    color: color.faint,
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
