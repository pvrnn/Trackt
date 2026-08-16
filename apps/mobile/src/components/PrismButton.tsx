import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { PRISM, color, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The primary action, ported from web's `Button` (design README: PRISM gradient
 * pill, `#14101A` label, 13px, tracked 0.06em, 12/24 padding).
 *
 * Web's hover `brightness(1.15)` has no touch equivalent; the press feedback is
 * opacity instead, which is the platform convention on both OSes. Phase 4 gives
 * this a Reanimated spring and a haptic — it is deliberately plain until then
 * rather than half-animated.
 *
 * `secondary` is the glass pill: the same geometry with a border instead of the
 * gradient, so the two never disagree about size when they sit in a column.
 */
export function PrismButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy;
  const content = (
    <View style={styles.content}>
      {busy && (
        <ActivityIndicator size="small" color={variant === 'primary' ? color.onPrism : color.fg} />
      )}
      <Text style={[type.button, { color: variant === 'primary' ? color.onPrism : color.fg }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [styles.pill, { opacity: inert ? 0.5 : pressed ? 0.85 : 1 }, style]}
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
        <View style={[styles.surface, styles.secondary]}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  surface: {
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  secondary: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
