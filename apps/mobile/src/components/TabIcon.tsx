import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The four tab icons from `Mobile System.dc.html` §03 (`V2_ICON_PATHS`): line
 * drawings at 24 on a 1.7 stroke, never unicode symbols — the faces the app
 * loads ship none of them, so the platform fallback picks a different size and
 * weight on each OS. No fill, so `color` alone carries the active state.
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
  const line = {
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' ? (
        <Path d="M4 11.5 12 4.5l8 7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" {...line} />
      ) : name === 'discover' ? (
        <>
          <Circle cx={11} cy={11} r={6.5} {...line} />
          <Path d="m16 16 4.5 4.5" {...line} />
        </>
      ) : name === 'news' ? (
        <>
          <Path d="M4.5 5.5h11v13a1.5 1.5 0 0 0 3 0V9.5h-3" {...line} />
          <Path d="M4.5 5.5v12a2 2 0 0 0 2 2h10.5" {...line} />
          <Path d="M7.5 9.5h5M7.5 13h5M7.5 16.5h3" {...line} />
        </>
      ) : (
        <>
          <Circle cx={12} cy={8.5} r={3.6} {...line} />
          <Path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" {...line} />
        </>
      )}
    </Svg>
  );
}
