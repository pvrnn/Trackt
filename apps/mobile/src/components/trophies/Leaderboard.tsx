import {
  DELTA_COLOR,
  formatDelta,
  PODIUM_BLOCKS,
  PODIUM_HEIGHTS,
  PODIUM_ORDER,
  topPercent,
} from '@trackt/client';
import {
  TROPHY_TIER_POINTS,
  trophyDefinition,
  type Leaderboard as Board,
  type LeaderboardRow,
  type TrophyTier,
} from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { color, radius, space, surface } from '../../theme/tokens';
import { font, displayLine } from '../../theme/typography';
import { Avatar } from '../Avatar';
import { Touchable } from '../Touchable';
import { useTrophyCopy } from './copy';
import { TierChip } from './TierChip';

const ROW_TIERS: TrophyTier[] = ['prism', 'gold', 'silver'];
/** The viewer's own row opens their profile tab rather than its public copy. */
const profileHref = (row: LeaderboardRow) =>
  row.isViewer ? ('/profile' as const) : (`/users/${row.username}` as const);

const RISE = { duration: 700, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };

/** `LinearGradient` wants two stops at least; a flat colour is the same stop twice. */
const stops = (list: readonly string[]) =>
  (list.length === 1 ? [list[0], list[0]] : [...list]) as [string, string, ...string[]];

function Block({ row, index, board }: { row: LeaderboardRow; index: number; board: Board }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const reduced = useReducedMotion();
  const height = useSharedValue(reduced ? (PODIUM_HEIGHTS[index] ?? 66) : 6);
  const target = PODIUM_HEIGHTS[index] ?? 66;
  const block = PODIUM_BLOCKS[index] ?? (PODIUM_BLOCKS[2] as (typeof PODIUM_BLOCKS)[number]);

  // The blocks rise again whenever the board changes underneath them.
  useEffect(() => {
    if (reduced) {
      height.value = target;
      return;
    }
    height.value = 6;
    height.value = withTiming(target, RISE);
  }, [board, reduced, target, height]);

  const blockStyle = useAnimatedStyle(() => ({ height: height.value }));
  const whoStyle = useAnimatedStyle(() => ({ opacity: height.value > target * 0.6 ? 1 : 0 }));
  const first = index === 0;
  const name = row.isViewer ? t('trophies.leaderboard.you', { username: row.username }) : row.name;

  return (
    <View style={styles.column}>
      <Animated.View style={[styles.who, whoStyle]}>
        <Touchable href={profileHref(row)} style={styles.whoLink} accessibilityLabel={name}>
          <View style={[styles.ring, first ? styles.ringFirst : null]}>
            <Avatar name={row.name} image={row.image} size={first ? 48 : 40} />
          </View>
          <Text style={styles.whoName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.whoPts}>
            {copy.number(row.points)} {t('trophies.ptsUnit')}
          </Text>
        </Touchable>
      </Animated.View>
      <View style={styles.blockTop}>
        <LinearGradient
          colors={stops(block.top)}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Animated.View style={[styles.block, blockStyle]}>
        <LinearGradient colors={stops(block.front)} style={StyleSheet.absoluteFill} />
        <Text style={styles.blockRank}>{index + 1}</Text>
      </Animated.View>
    </View>
  );
}

export function Podium({ board }: { board: Board }) {
  return (
    <View style={styles.podium}>
      {PODIUM_ORDER.map((index) => {
        const row = board.rows[index];
        return row ? (
          <Block key={index} row={row} index={index} board={board} />
        ) : (
          <View key={index} style={styles.column} />
        );
      })}
    </View>
  );
}

export function Chase({ board }: { board: Board }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const chase = board.chase;
  if (!chase) return null;
  const target = chase.trophy ? trophyDefinition(chase.trophy) : null;
  const body = target
    ? t('trophies.leaderboard.chaseBody', {
        trophy: copy.name(target),
        tier: copy.tier(target.tier).toLowerCase(),
        pts: TROPHY_TIER_POINTS[target.tier],
        rank: chase.rank,
      })
    : t('trophies.leaderboard.chaseBodyAny', { rank: chase.rank });
  return (
    <View style={styles.chase}>
      <Text style={styles.chaseArrow}>↑</Text>
      <View style={styles.chaseText}>
        <Text style={styles.chaseHead}>
          {t('trophies.leaderboard.chaseHead', {
            points: copy.number(chase.points),
            name: chase.rival,
          }).toUpperCase()}
        </Text>
        <Text style={styles.chaseBody}>{body}</Text>
      </View>
    </View>
  );
}

export function BoardRow({ row, rankLabel }: { row: LeaderboardRow; rankLabel: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const delta = formatDelta(row.delta);
  return (
    <Touchable href={profileHref(row)} style={[styles.row, row.isViewer ? styles.rowMe : null]}>
      <Text style={[styles.rank, row.isViewer ? { color: color.pinkInk } : null]}>{rankLabel}</Text>
      <Avatar name={row.name} image={row.image} size={36} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.isViewer ? t('trophies.leaderboard.you', { username: row.username }) : row.name}
        </Text>
        <View style={styles.tiers}>
          {ROW_TIERS.map((tier) => (
            <View key={tier} style={styles.tier}>
              <TierChip tier={tier} />
              <Text style={styles.tierN}>{row.tiers[tier]}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.rowEnd}>
        <Text style={styles.rowPts}>{copy.number(row.points)}</Text>
        {delta ? (
          <Text style={[styles.delta, { color: DELTA_COLOR[delta.tone] }]}>{delta.text}</Text>
        ) : null}
      </View>
    </Touchable>
  );
}

/** Everything under the podium: the rest of the board, then the viewer if they fell below it. */
export function BoardRows({ board }: { board: Board }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  return (
    <View style={styles.rows}>
      {board.rows.slice(3).map((row) => (
        <BoardRow key={row.username + row.rank} row={row} rankLabel={String(row.rank)} />
      ))}
      {board.viewer ? (
        <>
          <View style={styles.gap}>
            <View style={styles.gapLine} />
            <Text style={styles.gapLabel}>
              {t('trophies.leaderboard.top', {
                pct: topPercent(board.viewer.rank, board.population),
                population: copy.number(board.population),
              })}
            </Text>
            <View style={styles.gapLine} />
          </View>
          <BoardRow row={board.viewer} rankLabel={`#${copy.number(board.viewer.rank)}`} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.md,
    height: 262,
  },
  column: { width: 94, alignItems: 'center', justifyContent: 'flex-end' },
  who: { marginBottom: 14, width: 112 },
  whoLink: { alignItems: 'center', gap: 4 },
  ring: { borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', padding: 1 },
  ringFirst: {
    borderColor: color.pinkInk,
    shadowColor: color.pink,
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  whoName: { fontFamily: font.bodySemibold, fontSize: 12, color: color.fg, maxWidth: 112 },
  whoPts: { fontFamily: font.label, fontSize: 11, letterSpacing: 0.44, color: '#cfc9d8' },
  blockTop: {
    height: 14,
    width: 94,
    overflow: 'hidden',
    transform: [{ perspective: 200 }, { rotateX: '55deg' }],
    marginBottom: -4,
  },
  block: {
    width: 94,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.5)',
  },
  blockRank: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: displayLine(40),
    color: 'rgba(20,16,26,0.72)',
  },
  chase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderRadius: radius.cardSm,
    backgroundColor: 'rgba(217,107,176,0.1)',
    borderWidth: 1,
    borderColor: surface.pinkBorder,
  },
  chaseArrow: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: displayLine(26),
    color: color.pinkInk,
  },
  chaseText: { flex: 1, gap: 3 },
  chaseHead: { fontFamily: font.label, fontSize: 11, letterSpacing: 0.88, color: color.fg },
  chaseBody: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.muted },
  rows: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: 14,
    borderRadius: radius.cardSm,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  rowMe: {
    backgroundColor: surface.pinkRow,
    borderWidth: 1,
    borderColor: 'rgba(217,107,176,0.55)',
  },
  rank: {
    width: 40,
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: 0.24,
    color: color.muted,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 5 },
  rowName: { fontFamily: font.bodySemibold, fontSize: 14, color: color.fg },
  tiers: { flexDirection: 'row', gap: 10 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tierN: { fontFamily: font.label, fontSize: 10, color: color.muted },
  rowEnd: { alignItems: 'flex-end', gap: 4 },
  rowPts: { fontFamily: font.label, fontSize: 13, letterSpacing: 0.26, color: color.fg },
  delta: { fontFamily: font.label, fontSize: 10, letterSpacing: 0.4 },
  gap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  gapLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  gapLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: 1, color: color.dim },
});
