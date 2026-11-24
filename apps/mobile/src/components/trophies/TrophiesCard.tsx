import { nextUpTrophies, recentTrophies, useTrophyCabinet } from '@trackt/client';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, surface } from '../../theme/tokens';
import { font, type } from '../../theme/typography';
import { GlassCard } from '../GlassCard';
import { PrismText } from '../PrismText';
import { Touchable } from '../Touchable';
import { useTrophyCopy } from './copy';
import { Shelf } from './Shelf';

/** Profile's way into the cabinet: three crystals, the points, the standing among friends. */
export function TrophiesCard() {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const { data: cabinet } = useTrophyCabinet();
  if (!cabinet) return null;
  const recent = recentTrophies(cabinet, 3);
  const shelf = [...recent, ...nextUpTrophies(cabinet, 3 - recent.length)];

  return (
    <Touchable href="/trophies" accessibilityLabel={t('trophies.card.open')}>
      <GlassCard style={styles.card}>
        <View style={styles.head}>
          <Text style={[type.section, styles.title]}>{t('trophies.title').toUpperCase()}</Text>
          <Text style={styles.all}>{t('trophies.card.all', { count: cabinet.total })}</Text>
        </View>
        {cabinet.unlocked === 0 ? (
          <Text style={styles.empty}>{t('trophies.card.empty')}</Text>
        ) : null}
        <Shelf trophies={shelf} columns={3} showSub={false} interactive={false} />
        <View style={styles.foot}>
          <View style={styles.inline}>
            <PrismText style={styles.footText}>{copy.number(cabinet.points)}</PrismText>
            <Text style={[styles.footText, styles.dim]}> {t('trophies.ptsUnit')}</Text>
          </View>
          <Text style={styles.footText}>
            #{cabinet.friendsRank} <Text style={styles.dim}>{t('trophies.rankAmongFriends')}</Text>
          </Text>
        </View>
      </GlassCard>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: color.fg },
  all: { fontFamily: font.label, fontSize: 11, letterSpacing: 0.88, color: color.pinkInk },
  empty: { fontFamily: font.body, fontSize: 13, color: color.muted },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: surface.divider,
  },
  inline: { flexDirection: 'row', alignItems: 'baseline' },
  footText: { fontFamily: font.label, fontSize: 12, letterSpacing: 0.72, color: color.fg },
  dim: { color: color.dim },
});
