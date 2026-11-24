import { TIER_MATERIAL } from '@trackt/client';
import type { TrophyTier } from '@trackt/shared';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';

/** The little hexagon a tier is drawn as: a prism's cap seen from straight above. */
export function TierChip({
  tier,
  width = 9,
  opacity = 1,
}: {
  tier: TrophyTier;
  width?: number;
  opacity?: number;
}) {
  const height = width * 0.88;
  const stops = TIER_MATERIAL[tier].chip;
  const id = `chip-${tier}`;
  const points = [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ]
    .map(([x, y]) => `${(x as number) * width},${(y as number) * height}`)
    .join(' ');
  return (
    <Svg width={width} height={height} opacity={opacity}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {stops.map((c, i) => (
            <Stop
              key={c + i}
              offset={stops.length === 1 ? 0 : i / (stops.length - 1)}
              stopColor={c}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Polygon points={points} fill={`url(#${id})`} />
    </Svg>
  );
}
