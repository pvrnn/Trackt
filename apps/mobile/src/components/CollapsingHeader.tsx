import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackLink } from './Page';
import { layout, radius, space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** The collapsed bar `Mobile System.dc.html` fixes for both platforms: 44pt. */
const HEADER_HEIGHT = layout.touchTarget;

/** How far the hero scrolls before the bar is fully opaque. */
const HEADER_FADE = [120, 220] as const;

/**
 * The 44pt bar the page header collapses into (`Mobile System.dc.html`,
 * platform table: "collapses to a 44pt glass bar on scroll" on iOS, the small
 * app bar on Android — the same geometry either way).
 *
 * The back chevron does **not** fade: it is the screen's only in-app way out on
 * iOS, and an affordance that appears only once you have scrolled past it is
 * worse than no affordance. Only the glass and the title cross-fade in, and
 * they do it from the *hero* title's position, so what the bar shows is the
 * thing that just left rather than a new label.
 */
export function CollapsingHeader({
  title,
  scrollY,
}: {
  title: string;
  scrollY: SharedValue<number>;
}) {
  const insets = useSafeAreaInsets();

  const glassStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...HEADER_FADE], [0, 1], 'clamp'),
  }));

  // Over the hero art the back link needs its own ink to sit on (the mockup's
  // floating pill); once the bar's own glass has arrived it would be a second
  // surface on top of a surface, so it fades out as that fades in.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...HEADER_FADE], [1, 0], 'clamp'),
  }));

  return (
    <View
      style={[styles.headerBar, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, glassStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
        {/* The blur alone is not enough: §05 forbids content behind fighting
            the text. Same 82% ink the tab bar puts over its own blur. */}
        <View style={[StyleSheet.absoluteFill, styles.headerFill]} />
        <View style={styles.headerRule} />
      </Animated.View>
      <View style={styles.headerRow}>
        <View>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.backPill, pillStyle]}
            pointerEvents="none"
          />
          <BackLink />
        </View>
        <Animated.Text
          numberOfLines={1}
          style={[type.section, text.fg, styles.headerTitle, glassStyle]}
        >
          {title.toUpperCase()}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  headerFill: {
    backgroundColor: 'rgba(14,12,16,0.82)',
  },
  headerRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: surface.glassBorder,
  },
  headerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
  },
  headerTitle: {
    flex: 1,
  },
  backPill: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14,12,16,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    marginVertical: space.xs,
    marginHorizontal: -space.sm,
  },
});
