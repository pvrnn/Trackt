import Svg, { Path } from 'react-native-svg';

/**
 * The app's non-tab glyphs, drawn rather than typed — for the reason
 * `TabIcon` already documents: the three faces the app loads ship none of the
 * symbol characters the mockups write, so a `✓` in a `<Text>` falls through to
 * whatever the platform substitutes. On Android that is a hand-drawn-looking
 * tick at the wrong weight next to Space Grotesk; on iOS it is a different one.
 * A path is the same mark on both, at the stroke weight the rest of the icon
 * set uses.
 *
 * Same contract as `TabIcon`: stroked at 1.6, no fill, `color` carries state.
 */
export type IconName = 'check';

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'check' ? (
        <Path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
    </Svg>
  );
}
