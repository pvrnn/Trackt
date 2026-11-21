import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { AnimatedPressable, usePressMotion } from './Press';
import { PRISM, color, control, nativeInk, radius, space, stroke, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The primary action, ported from web's `Button` (design README: PRISM gradient
 * pill, `#14101A` label, 13px, tracked 0.06em, 12/24 padding).
 *
 * Web's hover `brightness(1.15)` has no touch equivalent; the press feedback is
 * the platform's opacity dip and, from phase 4, a 140ms spring to 0.96
 * (`usePressMotion`). No haptic: §07 reserves those for a commit, a threshold
 * and a failure, and a button that buzzes on press would spend the budget
 * before the thing it does has happened.
 *
 * `secondary` is the glass pill: the same geometry with a border instead of the
 * gradient, so the two never disagree about size when they sit in a column.
 * `state` is the pink-ringed pill for a settled state (connected, friends,
 * selected) — pink is the only state colour (§08).
 *
 * Heights follow the §08 button ladder: 54 primary, 46 secondary and state,
 * 44 with `size="row"` for an action inside a list row. They are minimums, so a
 * pair side by side in a row stretches to one height.
 */
export function PrismButton({
  label,
  icon,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
  size,
  accessibilityLabel,
  style,
}: {
  label: string;
  /** For when the label alone doesn't say what the button acts on. */
  accessibilityLabel?: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'state';
  /** Defaults to the variant's rung of the ladder. */
  size?: 'primary' | 'secondary' | 'row';
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy;
  const press = usePressMotion();
  const tint =
    variant === 'primary' ? color.onPrism : variant === 'state' ? nativeInk.pinkInk : color.fg;
  const height =
    control[size === 'row' ? 'inRow' : (size ?? (variant === 'primary' ? 'primary' : 'secondary'))];
  const content = (
    <View style={styles.content}>
      {busy ? <ActivityIndicator size="small" color={tint} /> : null}
      {/* The glyph the label used to spell out (`Icon`): drawn, and dropped
          while the spinner holds its place so the pill never wears two marks. */}
      {icon && !busy ? <Icon name={icon} color={tint} size={16} /> : null}
      <Text style={[type.button, { color: tint }]}>{label.toUpperCase()}</Text>
    </View>
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inert, busy }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={inert}
      style={[
        styles.pill,
        { minHeight: height },
        style,
        inert ? styles.inert : press.animatedStyle,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={[...PRISM]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.surface}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.surface, variant === 'state' ? styles.state : styles.secondary]}>
          {content}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  // A disabled button takes the flat dim and no press motion at all, rather
  // than an animated style that happens never to move.
  inert: {
    opacity: 0.5,
  },
  surface: {
    flexGrow: 1,
    paddingVertical: space.sm,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: surface.glass,
  },
  state: {
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: 'rgba(217,107,176,0.55)',
    backgroundColor: 'rgba(217,107,176,0.16)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
