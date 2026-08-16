import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { AURA, color } from '../theme/tokens';

/**
 * The background recipe every screen sits on (design README, "Background
 * recipe"): three large radial gradients over near-black.
 *
 * Web gets this from three stacked `radial-gradient()`s in `styles.css`; React
 * Native has no gradient background at all, so each radial becomes an SVG
 * ellipse with its own `RadialGradient` fill, positioned in fractions of the
 * screen so the composition holds on any device.
 *
 * The grain film is deliberately **not** here. It needs `mix-blend-mode:
 * overlay` over a tiled noise bitmap, which React Native cannot express — the
 * honest options are a pre-composited PNG per aura or nothing, and at phone
 * sizes and 0.5 opacity the difference is invisible. Revisit with the media
 * screens in phase 2, where large flat cover areas make banding visible.
 */
export function AuraBackground({ intensity = 1 }: { intensity?: number }) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color.ink }]} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {AURA.map((aura, i) => (
            <RadialGradient key={aura.color} id={`aura-${i}`}>
              <Stop offset="0" stopColor={aura.color} stopOpacity={aura.opacity * intensity} />
              {/* The web recipe fades to transparent by 65–70%; the ellipse is
                  sized to the full radius, so the stop carries that falloff. */}
              <Stop offset="0.68" stopColor={aura.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {AURA.map((aura, i) => (
          <Ellipse
            key={aura.color}
            cx={aura.cx * width}
            cy={aura.cy * height}
            rx={aura.rx * width}
            ry={aura.ry * height}
            fill={`url(#aura-${i})`}
          />
        ))}
      </Svg>
    </View>
  );
}
