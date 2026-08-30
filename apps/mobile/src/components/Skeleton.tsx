import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';
import { layout, nativeSurface, radius, space, stroke, surface } from '../theme/tokens';

/**
 * The loading shape a query shows before its first paint, in place of the
 * spinner where the screen already knows what it is about to draw.
 *
 * A spinner says "something is happening"; a skeleton says "three rows are
 * coming, here is where they will be", which is the difference between a screen
 * that jumps and one that fills in. Where the shape is *not* known — a search
 * with no result count, a sheet's list — `Loading` stays the right answer.
 *
 * The pulse is one shared value per block driving opacity, not a translating
 * highlight: a gradient sweep over a recycled `FlashList` row is a mask per row
 * per frame, and this list can be hundreds of rows long. Under reduce motion
 * the pulse does not run at all and the block sits at its middle opacity, which
 * still reads as "not content yet" (PRD §6).
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useSharedValue(0.5);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, style, animatedStyle]}
    />
  );
}

/** The up-next column's placeholder: `count` rows at the real 72pt height. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.rows}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} style={styles.row} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: surface.glassWell,
    borderRadius: radius.cardSm,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    height: 72,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: nativeSurface.row,
    minWidth: layout.touchTarget,
  },
});
