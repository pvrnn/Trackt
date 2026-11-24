import { useLeaderboard } from '@trackt/client';
import type { LeaderboardPeriod, LeaderboardScope } from '@trackt/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FilterBar } from '../../../src/components/FilterBar';
import { FilterSlab, SlabRow } from '../../../src/components/FilterSlab';
import { EmptyState, Loading, PageScroll, PageTitle } from '../../../src/components/Page';
import { BoardRows, Chase, Podium } from '../../../src/components/trophies/Leaderboard';
import { color, space } from '../../../src/theme/tokens';
import { font } from '../../../src/theme/typography';

const SCOPES: LeaderboardScope[] = ['global', 'friends'];
const PERIODS: LeaderboardPeriod[] = ['week', 'month', 'all'];

/** Global and Friends boards (`Mobile Trophies.dc.html` — LEADERBOARD · GLOBAL / FRIENDS). */
export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const { data, isError } = useLeaderboard(scope, period);
  const board = data?.scope === scope && data.period === period ? data : undefined;
  const lonely = board?.scope === 'friends' && board.population === 1;
  const nobody = board?.scope === 'global' && board.rows.length === 0;

  return (
    <PageScroll title={t('trophies.leaderboard.title')}>
      <PageTitle title={t('trophies.leaderboard.title')} />
      <FilterSlab>
        <View style={styles.seg} accessibilityRole="tablist">
          {SCOPES.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope === s }}
              onPress={() => setScope(s)}
              style={[styles.segButton, scope === s ? styles.segOn : null]}
            >
              <Text style={[styles.segText, { color: scope === s ? color.onPrism : color.muted }]}>
                {t(`trophies.leaderboard.${s}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <SlabRow>
          <FilterBar
            variant="slab"
            filters={[
              {
                key: 'period',
                icon: 'clock',
                caption: t('trophies.leaderboard.period'),
                label: t(`trophies.leaderboard.${period}`),
                rows: PERIODS.map((p) => ({
                  key: p,
                  label: t(`trophies.leaderboard.${p}`),
                  selected: p === period,
                })),
                onSelect: (key) => setPeriod(key as LeaderboardPeriod),
              },
            ]}
          />
        </SlabRow>
      </FilterSlab>

      <View style={styles.body}>
        {!board ? (
          isError ? (
            <EmptyState title={t('trophies.leaderboard.title')} body={t('trophies.loadError')} />
          ) : (
            <Loading />
          )
        ) : lonely ? (
          <EmptyState
            title={t('trophies.leaderboard.friends')}
            body={t('trophies.leaderboard.noFriends')}
          />
        ) : (
          <>
            {nobody ? (
              <Text style={styles.empty}>{t('trophies.leaderboard.empty')}</Text>
            ) : (
              <Podium board={board} />
            )}
            <Chase board={board} />
            <BoardRows board={board} />
          </>
        )}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', padding: 4, gap: 4 },
  segButton: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segOn: { backgroundColor: color.fg },
  segText: { fontFamily: font.label, fontSize: 12, letterSpacing: 0.96 },
  body: { gap: space.lg, marginTop: space.lg },
  empty: {
    fontFamily: font.body,
    fontSize: 14,
    color: color.muted,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
