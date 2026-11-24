import { MEDAL_SPIN, medalKindDots, medalLook, trophyPercent } from '@trackt/client';
import type { TrophyEntry } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { color } from '../../theme/tokens';
import { KIND_COLORS } from '../KindDot';
import { font } from '../../theme/typography';
import { useTrophyCopy } from './copy';
import { TierChip } from './TierChip';

const D = 168;
const THICKNESS = 16;

/**
 * The detail screen's medal. Web turns a 48-slice milled edge in CSS 3D; here
 * the disc is projected: the visible face narrows to `|cos a|`, the edge shows
 * as a band `THICKNESS·|sin a|` wide behind it, and the back face takes over
 * once the front turns away.
 */
export function Medal({ trophy, owner }: { trophy: TrophyEntry; owner: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const look = medalLook(trophy);
  const reduced = useReducedMotion();
  const rotation = useSharedValue(reduced ? 18 : 0);
  const velocity = useSharedValue<number>(MEDAL_SPIN.idleDegPerMs);
  const dragging = useSharedValue(false);
  const base = useSharedValue(0);

  // A release keeps the fling's speed, which relaxes back to the idle turn.
  useFrameCallback((frame) => {
    if (dragging.value) return;
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 64);
    const idle = reduced ? 0 : MEDAL_SPIN.idleDegPerMs;
    velocity.value = idle + (velocity.value - idle) * Math.exp(-dt / MEDAL_SPIN.settleMs);
    rotation.value += velocity.value * dt;
  });

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      dragging.value = true;
      base.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = base.value + e.translationX * MEDAL_SPIN.dragDegPerPx;
    })
    .onFinalize((e) => {
      const fling = (e.velocityX * MEDAL_SPIN.dragDegPerPx) / 1000;
      velocity.value = Math.max(-MEDAL_SPIN.maxDegPerMs, Math.min(MEDAL_SPIN.maxDegPerMs, fling));
      dragging.value = false;
    });

  const rimStyle = useAnimatedStyle(() => {
    const a = (rotation.value * Math.PI) / 180;
    const width = D * Math.abs(Math.cos(a)) + THICKNESS * Math.abs(Math.sin(a));
    return { transform: [{ scaleX: Math.max(width / D, 0.001) }] };
  });
  const frontStyle = useAnimatedStyle(() => {
    const a = (rotation.value * Math.PI) / 180;
    const c = Math.cos(a);
    return {
      opacity: c > 0 ? 1 : 0,
      transform: [
        { translateX: (THICKNESS / 2) * Math.sin(a) },
        { scaleX: Math.max(Math.abs(c), 0.001) },
      ],
    };
  });
  const backStyle = useAnimatedStyle(() => {
    const a = (rotation.value * Math.PI) / 180;
    const c = Math.cos(a);
    return {
      opacity: c < 0 ? 1 : 0,
      transform: [
        { translateX: -(THICKNESS / 2) * Math.sin(a) },
        { scaleX: Math.max(Math.abs(c), 0.001) },
      ],
    };
  });

  const rimColors = look.rim.filter((_, i) => i % 4 === 0);
  const faceColors = (look.face.length > 1 ? [...look.face] : [look.face[0], look.face[0]]) as [
    string,
    string,
    ...string[],
  ];
  const isPolyglot = trophy.id === 'polyglot' && !look.locked;
  const emblemSub = look.locked
    ? t('trophies.medal.there', { pct: trophyPercent(trophy) })
    : isPolyglot
      ? t('trophies.medal.kinds', { count: trophy.evidence.length })
      : copy.tierPoints(trophy);
  const dim = look.locked ? 0.45 : 1;

  return (
    <View style={styles.wrap}>
      <View style={[styles.halo, { backgroundColor: look.halo }]} />
      <GestureDetector gesture={pan}>
        <View
          style={styles.stage}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('trophies.medal.aria', { name: copy.name(trophy) })}
        >
          <Animated.View style={[styles.disc, rimStyle]}>
            <LinearGradient
              colors={rimColors as [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View style={[styles.disc, frontStyle]}>
            <LinearGradient
              colors={faceColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
              start={{ x: 0.2, y: 0.1 }}
              end={{ x: 0.55, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.well}>
              {isPolyglot
                ? trophy.evidence.map((e, i) => {
                    const dot = medalKindDots(54)[i] ?? { x: 0, y: 0 };
                    return (
                      <View
                        key={e.kind}
                        style={[
                          styles.kindDot,
                          {
                            left: 68 + dot.x - 5,
                            top: 68 + dot.y - 5,
                            backgroundColor: KIND_COLORS[e.kind],
                          },
                        ]}
                      />
                    );
                  })
                : null}
              <View style={styles.emblem}>
                <TierChip tier={trophy.tier} width={34} opacity={dim} />
                <Text style={[styles.emblemName, { opacity: dim }]} numberOfLines={2}>
                  {copy.name(trophy).toUpperCase()}
                </Text>
                <Text style={styles.emblemSub}>{emblemSub}</Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View style={[styles.disc, backStyle]}>
            <LinearGradient
              colors={faceColors}
              start={{ x: 1, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.well, styles.back]}>
              <Text style={styles.backSmall}>TRACKT</Text>
              <Text style={styles.backName}>{owner.toUpperCase()}</Text>
              {trophy.unlockedAt && trophy.serial ? (
                <>
                  <Text style={styles.backSmall}>{copy.date(trophy.unlockedAt)}</Text>
                  <Text style={styles.backSmall}>
                    #{copy.number(trophy.serial)} / {copy.number(trophy.holders)}
                  </Text>
                </>
              ) : (
                <Text style={styles.backSmall}>{t('trophies.medal.notYet')}</Text>
              )}
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
      <Text style={styles.hint}>{t('trophies.medal.drag')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  halo: {
    position: 'absolute',
    top: 20,
    width: 230,
    height: 210,
    borderRadius: 115,
    opacity: 0.55,
  },
  stage: { height: 250, width: '100%', alignItems: 'center', justifyContent: 'center' },
  disc: {
    position: 'absolute',
    width: D,
    height: D,
    borderRadius: D / 2,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  well: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: (D - 32) / 2,
    backgroundColor: '#16121c',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  emblem: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
  },
  emblemName: {
    fontFamily: font.display,
    fontSize: 15,
    letterSpacing: 0.6,
    color: color.fg,
    textAlign: 'center',
  },
  emblemSub: { fontFamily: font.label, fontSize: 9, letterSpacing: 1.08, color: color.muted },
  kindDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  back: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  backSmall: { fontFamily: font.label, fontSize: 8, letterSpacing: 0.96, color: color.dim },
  backName: { fontFamily: font.display, fontSize: 15, letterSpacing: 0.9, color: '#cfc9d8' },
  hint: {
    marginTop: -18,
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.dim,
  },
});
