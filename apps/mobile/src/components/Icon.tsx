import Svg, { Circle, Path } from 'react-native-svg';

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
export type IconName = 'check' | 'settings';

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
      ) : (
        <>
          {/* An 8-tooth cog, generated on a 24 grid (outer 9.3, inner 6.7) so
              the teeth are even — a hand-placed gear reads as wonky at 20px
              long before anyone can say why. */}
          <Path
            d="M10.23 2.87 L13.77 2.87 L13.96 5.59 L15.15 6.08 L17.2 4.29 L19.71 6.8 L17.92 8.85 L18.41 10.04 L21.13 10.23 L21.13 13.77 L18.41 13.96 L17.92 15.15 L19.71 17.2 L17.2 19.71 L15.15 17.92 L13.96 18.41 L13.77 21.13 L10.23 21.13 L10.04 18.41 L8.85 17.92 L6.8 19.71 L4.29 17.2 L6.08 15.15 L5.59 13.96 L2.87 13.77 L2.87 10.23 L5.59 10.04 L6.08 8.85 L4.29 6.8 L6.8 4.29 L8.85 6.08 L10.04 5.59 Z"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            fill="none"
          />
          <Circle cx={12} cy={12} r={3.1} stroke={color} strokeWidth={1.6} fill="none" />
        </>
      )}
    </Svg>
  );
}
