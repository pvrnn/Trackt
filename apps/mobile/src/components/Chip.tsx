import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { color, radius, space, surface } from '../theme/tokens';
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
      <Text style={[type.label, { color: selected ? color.pink : color.dim }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

/**
 * A horizontally scrolling chip row. Filter rows routinely run wider than
 * 362pt — six kinds plus "all" already do — and wrapping them costs a line of
 * vertical space on the screen where it is scarcest.
 */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  );
}

/** The vertical hairline History's filter row uses to split year from season. */
export function ChipDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resting: {
    backgroundColor: surface.glass,
    borderColor: surface.glassBorder,
  },
  selected: {
    backgroundColor: surface.pinkSelected,
    borderColor: color.pink,
  },
  row: {
    gap: space.sm,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: space.sm,
    marginHorizontal: space.xs,
    backgroundColor: surface.divider,
  },
});
