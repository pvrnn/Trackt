import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';
import { PrismText } from './PrismText';
import { radius, space, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** The wrapping row: stats wrap two-up at any width. */
export function Stats({ children }: { children: ReactNode }) {
  return <View style={styles.stats}>{children}</View>;
}

/**
 * One number and what it counts. `compact` is the profile header's variant —
 * value and label on one baseline, at two thirds the size, because four of
 * them sit above the fold there rather than being the block itself.
 */
export function Stat({
  value,
  label,
  compact = false,
}: {
  value: number;
  label: string;
  compact?: boolean;
}) {
  return (
    <GlassCard style={compact ? styles.compactCard : styles.card}>
      <View style={styles.shrink}>
        <PrismText style={compact ? styles.compactValue : type.stat}>{String(value)}</PrismText>
      </View>
      <Text style={compact ? styles.compactLabel : [type.eyebrow, text.dim]}>
        {label.toUpperCase()}
      </Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  card: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: space.lg,
    gap: space.xs,
  },
  // PrismText sizes itself to its mask, so it needs a shrink-to-fit parent.
  shrink: {
    alignSelf: 'flex-start',
  },
  compactCard: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingVertical: space.md - 2,
    paddingHorizontal: space.md,
    borderRadius: radius.cardSm - 4,
  },
  compactValue: {
    fontFamily: type.stat.fontFamily,
    fontSize: 20,
    lineHeight: 21,
  },
  compactLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 9,
    letterSpacing: 0.72,
    ...text.dim,
  },
});
