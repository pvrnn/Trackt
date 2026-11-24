import { PRISM_GEOMETRY, prismLook, prismSpin, type PrismFace } from '@trackt/client';
import type { TrophyEntry } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, {
  Defs,
  Ellipse,
  LinearGradient as SvgGradient,
  Polygon,
  RadialGradient,
  Stop,
} from 'react-native-svg';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

const { apothem: R, faceWidth: W, width: WIDTH } = PRISM_GEOMETRY;
/** Seen from 12° above: how much of the top plane's depth survives on screen. */
const TILT = Math.sin((12 * Math.PI) / 180);
const CIRCUMRADIUS = WIDTH / 2;
const CAP_HALF = CIRCUMRADIUS * TILT;
/** A reduced-motion prism stops here, turned enough to show three faces. */
const RESTING = 20;

/**
 * Web spins these with CSS `preserve-3d`; React Native flattens children, so
 * each face is projected by hand on the UI thread: a face at angle `a` sits
 * `R·sin a` off the axis, is `cos a` as wide, and is gone once it turns away.
 * A convex prism has no overlapping front faces, so no depth sort is needed.
 */
function Face({
  face,
  index,
  spin,
  height,
}: {
  face: PrismFace;
  index: number;
  spin: SharedValue<number>;
  height: number;
}) {
  const style = useAnimatedStyle(() => {
    const a = ((spin.value + index * 60) * Math.PI) / 180;
    const c = Math.cos(a);
    return {
      opacity: c > 0.02 ? 1 : 0,
      transform: [{ translateX: R * Math.sin(a) }, { scaleX: Math.max(c, 0.001) }],
    };
  });
  return (
    <Animated.View style={[styles.face, { height }, style]}>
      {face.type === 'glass' ? (
        <LinearGradient
          colors={[face.tint, face.tint, face.empty, face.empty]}
          locations={[0, face.fill, face.fill, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <>
          <LinearGradient colors={[face.top, face.bottom]} style={StyleSheet.absoluteFill} />
          {face.sheen ? (
            <LinearGradient
              colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
              locations={[0, 0.45]}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${face.shade})` }]}
            />
          )}
        </>
      )}
    </Animated.View>
  );
}

function Cap({ stops, spin }: { stops: readonly string[]; spin: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    let points = '';
    for (let k = 0; k < 6; k += 1) {
      const a = ((spin.value + k * 60 + 30) * Math.PI) / 180;
      const x = CIRCUMRADIUS + CIRCUMRADIUS * Math.sin(a);
      const y = CAP_HALF + CAP_HALF * Math.cos(a);
      points += `${x},${y} `;
    }
    return { points };
  });
  const id = `cap-${stops.join('').replace(/\W/g, '')}`;
  return (
    <Svg width={WIDTH} height={CAP_HALF * 2} style={styles.cap}>
      <Defs>
        <SvgGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {stops.map((c, i) => (
            <Stop
              key={c + i}
              offset={stops.length === 1 ? 0 : i / (stops.length - 1)}
              stopColor={c}
            />
          ))}
        </SvgGradient>
      </Defs>
      <AnimatedPolygon animatedProps={props} fill={`url(#${id})`} />
    </Svg>
  );
}

export function Prism({
  trophy,
  index,
  paused = false,
}: {
  trophy: TrophyEntry;
  index: number;
  paused?: boolean;
}) {
  const look = prismLook(trophy);
  const { durationMs, phase } = prismSpin(index);
  const reduced = useReducedMotion();
  const spin = useSharedValue(reduced ? RESTING : phase * 360);

  useEffect(() => {
    if (reduced || paused) {
      cancelAnimation(spin);
      return;
    }
    const from = spin.value;
    spin.value = withRepeat(
      withTiming(from + 360, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(spin);
  }, [reduced, paused, durationMs, spin]);

  const glowId = `glow-${trophy.id}`;
  return (
    <View style={{ width: WIDTH, height: look.height + CAP_HALF }}>
      <Svg width={100} height={24} style={styles.glow}>
        <Defs>
          <RadialGradient id={glowId} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={look.glow} />
            <Stop offset="1" stopColor={look.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={50} cy={12} rx={50} ry={12} fill={`url(#${glowId})`} />
      </Svg>
      <View style={[styles.body, { top: CAP_HALF, height: look.height }]}>
        {look.faces.map((face, i) => (
          <Face key={i} face={face} index={i} spin={spin} height={look.height} />
        ))}
      </View>
      <Cap stops={look.cap} spin={spin} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { position: 'absolute', left: 0, width: WIDTH },
  face: {
    position: 'absolute',
    top: 0,
    left: (WIDTH - W) / 2,
    width: W,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  cap: { position: 'absolute', top: 0, left: 0 },
  glow: { position: 'absolute', bottom: -12, left: -30 },
});
