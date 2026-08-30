import { Pressable, StyleSheet, Text } from 'react-native';
import { color, radius, space, stroke, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The filter pill (design README, "Chips"): Space Grotesk 600, selected reads
 * pink on `rgba(217,107,176,0.18)`.
 *
 * 44pt minimum height, no exceptions (Mobile System §01) — on web these are
 * 28px tall, which is a mis-tap on a phone. The padding is what grows; the type
 * size stays where the design put it.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.resting,
        { opacity: disabled ? 0.25 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.label, { color: selected ? color.pink : color.muted }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    // 44 tall means a 22pt cap; `space.lg` put the label inside the arc.
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: stroke,
  },
  resting: {
    backgroundColor: surface.glass,
    borderColor: surface.glassBorder,
  },
  selected: {
    backgroundColor: surface.pinkSelected,
    borderColor: color.pink,
  },
});
