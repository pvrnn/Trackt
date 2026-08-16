import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The four tab glyphs from `Mobile System.dc.html` §03, drawn rather than typed.
 *
 * The mockup writes them as the characters ▤ ⌕ ◈ ◍, which is fine in a browser
 * with a full Unicode fallback chain and unreliable on device — the app loads
 * three text faces, none of which ships those glyphs, so the system fallback
 * decides how they look per platform. Four small paths keep them identical.
 *
 * Stroked at 1.6 with no fill, so `color` alone carries the active state.
 */
export type TabName = 'home' | 'discover' | 'news' | 'profile';

export function TabIcon({
  name,
  color,
  size = 24,
}: {
  name: TabName;
  color: string;
  size?: number;
}) {
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' ? (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} {...stroke} />
          <Path d="M3.5 9.5h17" {...stroke} />
          <Path d="M9 9.5v10" {...stroke} />
        </>
      ) : name === 'discover' ? (
        <>
          <Circle cx={10.5} cy={10.5} r={6} {...stroke} />
          <Path d="M15 15l4.5 4.5" strokeLinecap="round" {...stroke} />
        </>
      ) : name === 'news' ? (
        <>
          <Path d="M12 3.5l8 8.5-8 8.5-8-8.5z" strokeLinejoin="round" {...stroke} />
          <Path d="M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z" strokeLinejoin="round" {...stroke} />
        </>
      ) : (
        <>
          <Circle cx={12} cy={9} r={3.6} {...stroke} />
          <Path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" strokeLinecap="round" {...stroke} />
        </>
      )}
    </Svg>
  );
}
