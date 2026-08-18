import { useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { selectionHaptic } from '../lib/haptics';
import { SWIPE, duration, springBack, swipeTranslation, trackOpacity } from '../lib/motion';
import { color, nativeSurface, radius, space } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * Swipe an up-next row to the right to check in (`Mobile System.dc.html` §04) —
 * the interaction the design calls the app's core one, and the last thing phase
 * 3 left as a button.
 *
 * The thresholds are §04's, and they live in `lib/motion.ts` so a test can hold
 * them to the spec: under 32pt the track only ghosts in, because the gesture
 * can still resolve as a scroll and nothing has been decided; at 96pt the row
 * is armed, the label changes and a selection tick fires; releasing there
 * commits, and releasing short of it springs back over 180ms.
 *
 * **The button stays.** A pan has nothing to offer VoiceOver, TalkBack or
 * switch control, and the design's "a dim chevron is the only affordance" would
 * leave those users with no check-in at all — the same reasoning that keeps the
 * rating chips under the star row. The swipe is the fast path, not the only one.
 *
 * The exit is driven by `committed`, not by the gesture, so the button and the
 * swipe animate identically and so the row can come *back*: an undo, or a write
 * the server rejected, flips `committed` false and the row springs open again.
 * That is the phase's second rule — the optimistic update and its animation are
 * one unit, and the unit has to be reversible.
 */
export function SwipeCheckIn({
  label,
  armedLabel,
  committed,
  disabled = false,
  onCommit,
  children,
}: {
  /** What the track says while the row is being dragged: 'WATCH E13'. */
  label: string;
  /** What it says once armed: 'RELEASE TO WATCH E13'. */
  armedLabel: string;
  /** True once the check-in is in flight or done — the row exits and collapses. */
  committed: boolean;
  disabled?: boolean;
  onCommit: () => void;
  children: ReactNode;
}) {
  const x = useSharedValue(0);
  const open = useSharedValue(1);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  // Mirrors `committed` on the UI thread. The exit sweeps `x` straight past the
  // armed threshold, and a check-in from the *button* would otherwise fire a
  // threshold tick on its way out — on top of the commit impact the mutation
  // already fires. Two haptics for one action is exactly what §07's "reserved
  // for state changes the user cannot see confirmed elsewhere" rules out.
  const exiting = useSharedValue(false);
  const reduced = useReducedMotion();

  // A selection tick the moment the row arms, and only then. `prev` is null on
  // the first run, which would otherwise buzz on mount.
  useAnimatedReaction(
    () => x.value >= SWIPE.armed,
    (armed, prev) => {
      if (armed && prev === false && !exiting.value) runOnJS(selectionHaptic)();
    },
  );

  // The exit and its reverse. Under reduce motion neither runs: the row keeps
  // its place and says "✓ WATCHED" on the button, which is phase 3's behaviour
  // and the right one to fall back to (PRD §6).
  useEffect(() => {
    exiting.value = committed;
    if (reduced) return;
    if (committed) {
      x.value = withTiming(width.value + space.xl, { duration: duration.commit });
      open.value = withTiming(0, { duration: duration.commit });
    } else {
      x.value = withSpring(0, springBack);
      open.value = withTiming(1, { duration: duration.commit });
    }
  }, [committed, reduced, x, open, width, exiting]);

  const pan = Gesture.Pan()
    .enabled(!disabled && !committed)
    // 12pt of horizontal travel before the row moves at all, and any real
    // vertical intent hands the touch back to the scroll view. Without the
    // second rule the list becomes impossible to scroll from a row.
    .activeOffsetX(12)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      x.value = swipeTranslation(event.translationX);
    })
    .onEnd(() => {
      if (x.value >= SWIPE.armed) {
        // The commit runs now, not after the exit: the mutation is optimistic
        // and the parent flips `committed`, which is what plays the exit.
        runOnJS(onCommit)();
      } else {
        x.value = withSpring(0, springBack);
      }
    });

  // The row does not fade while it is being dragged — §04 keeps it at full
  // opacity right through ARMED, and a row that dims under the finger reads as
  // being thrown away rather than being decided about. The fade belongs to the
  // exit, so it starts past the point the finger can reach without resistance.
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity:
      width.value > SWIPE.armed + SWIPE.slack
        ? interpolate(x.value, [SWIPE.armed + SWIPE.slack, width.value], [1, 0], 'clamp')
        : 1,
  }));

  const trackStyle = useAnimatedStyle(() => ({ opacity: trackOpacity(x.value) }));

  const restLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [SWIPE.armed - 8, SWIPE.armed], [1, 0], 'clamp'),
  }));

  const armedLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [SWIPE.armed - 8, SWIPE.armed], [0, 1], 'clamp'),
  }));

  // `height` stays 0 until the first layout, and an unmeasured row renders at
  // its natural height — otherwise every row would flash collapsed on mount.
  // The static `marginBottom` in `styles.clip` is what the column is spaced by
  // until then; once measured this style takes it over so a collapsing row
  // takes its own spacing with it.
  const collapseStyle = useAnimatedStyle(() =>
    height.value === 0
      ? {}
      : { height: height.value * open.value, marginBottom: space.sm * open.value },
  );

  const onLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width;
    if (open.value === 1) height.value = event.nativeEvent.layout.height;
  };

  return (
    <Animated.View style={[styles.clip, collapseStyle]} onLayout={onLayout}>
      <Animated.View
        // Decorative: the row's own button already announces the action, and a
        // track that reads "RELEASE TO WATCH E13" to a screen reader describes
        // a gesture that reader cannot perform.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.track, trackStyle]}
      >
        {/* Both labels share one box so the swap is a cross-fade rather than a
            reflow: the armed one is absolute over the resting one, single-line
            so it extends to the right instead of wrapping the box taller. */}
        <View>
          <Animated.Text numberOfLines={1} style={[type.button, styles.trackText, restLabelStyle]}>
            {label.toUpperCase()}
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            style={[type.button, styles.trackText, styles.trackTextOver, armedLabelStyle]}
          >
            {armedLabel.toUpperCase()}
          </Animated.Text>
        </View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderRadius: radius.cover,
    marginBottom: space.sm,
  },
  track: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.cover,
    backgroundColor: nativeSurface.track,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  trackText: {
    color: color.pink,
  },
  trackTextOver: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
