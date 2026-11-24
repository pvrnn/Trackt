import { TIERS_RAREST_FIRST } from '@trackt/client';
import type { TrophyCabinet } from '@trackt/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, surface } from '../../theme/tokens';
import { font } from '../../theme/typography';
import { GlassCard } from '../GlassCard';
import { PrismText } from '../PrismText';
import { useTrophyCopy } from './copy';
import { TierChip } from './TierChip';

/** Points and standing over the tier mix, as little prism caps. */
export function TrophySummary({ cabinet }: { cabinet: TrophyCabinet }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  return (
    <GlassCard>
      <View style={styles.head}>
        <View style={styles.points}>
          <Text style={styles.lab}>{t('trophies.points')}</Text>
          <PrismText style={styles.big}>{copy.number(cabinet.points)}</PrismText>
        </View>
        <View style={styles.ranks}>
          <Text style={styles.rank}>
            #{copy.number(cabinet.friendsRank)}{' '}
            <Text style={styles.rankLab}>{t('trophies.rankFriends')}</Text>
          </Text>
          <Text style={styles.rank}>
            {cabinet.globalMonthRank ? `#${copy.number(cabinet.globalMonthRank)}` : '—'}{' '}
            <Text style={styles.rankLab}>{t('trophies.rankGlobalMonth')}</Text>
          </Text>
        </View>
      </View>
      <View style={styles.mix}>
        {TIERS_RAREST_FIRST.map((tier, i) => (
          <View key={tier} style={[styles.cell, i > 0 ? styles.ruled : null]}>
            <TierChip tier={tier} width={16} />
            <Text style={styles.n}>{cabinet.tiers[tier]}</Text>
            <Text style={styles.cellLab}>{copy.tier(tier)}</Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: 14,
  },
  points: { gap: 4 },
  lab: { fontFamily: font.label, fontSize: 10, letterSpacing: 1, color: color.dim },
  big: { fontFamily: font.display, fontSize: 34, lineHeight: 38 },
  ranks: { alignItems: 'flex-end', gap: 6 },
  rank: { fontFamily: font.label, fontSize: 12, letterSpacing: 0.72, color: color.fg },
  rankLab: { color: color.dim },
  mix: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: surface.divider },
  cell: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: space.md },
  ruled: { borderLeftWidth: 1, borderLeftColor: surface.divider },
  n: { fontFamily: font.display, fontSize: 20, lineHeight: 22, color: color.fg },
  cellLab: { fontFamily: font.label, fontSize: 8, letterSpacing: 0.8, color: color.dim },
});
