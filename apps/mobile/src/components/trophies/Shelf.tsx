import { TIER_MATERIAL } from '@trackt/client';
import type { TrophyEntry } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, space } from '../../theme/tokens';
import { font } from '../../theme/typography';
import { useTrophyCopy } from './copy';
import { Prism } from './Prism';

/**
 * A plank of prisms with their names under them. Tapping one opens its medal;
 * holding it stops it turning, which is what the shelf's hint promises.
 */
export function Shelf({
  trophies,
  columns,
  offset = 0,
  showSub = true,
  interactive = true,
}: {
  trophies: TrophyEntry[];
  columns: number;
  offset?: number;
  showSub?: boolean;
  /** Off where the whole shelf is one link (the profile card). */
  interactive?: boolean;
}) {
  const router = useRouter();
  const copy = useTrophyCopy();
  const [held, setHeld] = useState<string | null>(null);
  const cell = { width: `${100 / columns}%` as const };

  return (
    <View>
      <View style={styles.stage}>
        {trophies.map((trophy, i) => {
          const prism = <Prism trophy={trophy} index={offset + i} paused={held === trophy.id} />;
          return interactive ? (
            <Pressable
              key={trophy.id}
              accessibilityRole="button"
              accessibilityLabel={copy.name(trophy)}
              onPress={() => router.push({ pathname: '/trophies/[id]', params: { id: trophy.id } })}
              onPressIn={() => setHeld(trophy.id)}
              onPressOut={() => setHeld(null)}
              style={[styles.slot, cell]}
            >
              {prism}
            </Pressable>
          ) : (
            <View key={trophy.id} style={[styles.slot, cell]}>
              {prism}
            </View>
          );
        })}
      </View>
      <View style={styles.plank}>
        <LinearGradient
          colors={['rgba(255,255,255,0.03)', 'rgba(255,255,255,0.12)']}
          style={styles.plankTop}
        />
        <LinearGradient colors={['#3b3344', '#1d1823']} style={styles.plankFront} />
      </View>
      <View style={styles.labels}>
        {trophies.map((trophy) => (
          <View key={trophy.id} style={[styles.label, cell]}>
            <Text style={styles.name} numberOfLines={2}>
              {copy.name(trophy)}
            </Text>
            <Text style={[styles.meta, { color: TIER_MATERIAL[trophy.tier].fg }]}>
              {copy.tierPoints(trophy)}
            </Text>
            {showSub ? <Text style={[styles.meta, styles.sub]}>{copy.sub(trophy)}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flexDirection: 'row', alignItems: 'flex-end', height: 92, paddingTop: space.md },
  slot: { alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 },
  plank: { marginHorizontal: space.xs },
  plankTop: {
    height: 12,
    marginHorizontal: space.sm,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  plankFront: {
    height: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.28)',
  },
  labels: { flexDirection: 'row', marginTop: space.sm },
  label: { alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  name: {
    fontFamily: font.bodySemibold,
    fontSize: 13,
    lineHeight: 16,
    color: color.fg,
    textAlign: 'center',
  },
  meta: { fontFamily: font.label, fontSize: 9, letterSpacing: 0.72, textAlign: 'center' },
  sub: { color: color.dim },
});
