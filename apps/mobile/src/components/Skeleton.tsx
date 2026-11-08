import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
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

/**
 * The Discover grid before its tiles: a cover block with the two caption lines
 * beneath, measured to the same columns the real grid uses. Nine fill the fold
 * under the fixed header; `count={3}` is the same shape for a page still on its
 * way at the foot of the list.
 */
export function SearchSkeleton({ columns = 3, count = 9 }: { columns?: number; count?: number }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - layout.gutter * 2 - space.md * (columns - 1)) / columns);
  return (
    <View accessible accessibilityLabel={t('common.loading')} style={styles.grid}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ width: size }}>
          <Skeleton
            style={{
              width: size,
              height: Math.round((size * 3) / 2),
              borderRadius: radius.cover,
            }}
          />
          <Skeleton style={styles.gridLine} />
          <Skeleton style={styles.gridLineShort} />
        </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.lg,
  },
  gridLine: {
    height: 12,
    width: '85%',
    marginTop: space.sm,
    borderRadius: 6,
  },
  gridLineShort: {
    height: 8,
    width: '40%',
    marginTop: space.xs,
    borderRadius: 4,
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
