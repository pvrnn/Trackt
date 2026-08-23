import type { ReactNode } from 'react';
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
 * The two `-filled` names are the exception the pair demands — a rating star
 * and a favourited heart say *set* by being solid, and an outline beside a
 * solid of the same path is the whole affordance.
 */
export type IconName =
  | 'check'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'pencil'
  | 'list'
  | 'clock'
  | 'search'
  | 'person'
  | 'share'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'star'
  | 'star-filled'
  | 'heart'
  | 'heart-filled';

/** The 24-grid path of every single-path glyph; the two-part ones are below. */
const PATHS: Record<Exclude<IconName, 'settings'>, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  // A pencil at 45°: nib at the bottom left, eraser end top right.
  pencil: 'M4 20l1-4.2L15.6 5.2a2.1 2.1 0 0 1 3 3L8.2 19z',
  list: 'M4 7h16M4 12h16M4 17h10',
  // A clock: the face as two arcs, then the hands.
  clock: 'M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6M12 7.2V12l3.4 2',
  search: 'M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12M15 15l4.6 4.6',
  // The tab bar's profile glyph, at row scale: head over shoulders.
  person: 'M12 5.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2M4.8 20a7.2 7.2 0 0 1 14.4 0',
  // The platform share mark: something leaving a tray, upward.
  share:
    'M12 15.5V4M8.4 7.6 12 4l3.6 3.6M5.5 12.5v5.6a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6v-5.6',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-left': 'M14.5 5.5L8 12l6.5 6.5',
  'chevron-right': 'M9.5 5.5L16 12l-6.5 6.5',
  'arrow-up': 'M12 19.5V5M6 11l6-6 6 6',
  'arrow-down': 'M12 4.5V19M6 13l6 6 6-6',
  star: 'M12 3l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.77l-5.8 3.06 1.11-6.45L2.62 9.81l6.48-.94z',
  'star-filled':
    'M12 3l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.77l-5.8 3.06 1.11-6.45L2.62 9.81l6.48-.94z',
  heart:
    'M20.3 5.2a4.9 4.9 0 0 0-6.93 0L12 6.57l-1.37-1.37a4.9 4.9 0 1 0-6.93 6.93L12 20.43l8.3-8.3a4.9 4.9 0 0 0 0-6.93z',
  'heart-filled':
    'M20.3 5.2a4.9 4.9 0 0 0-6.93 0L12 6.57l-1.37-1.37a4.9 4.9 0 1 0-6.93 6.93L12 20.43l8.3-8.3a4.9 4.9 0 0 0 0-6.93z',
};

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'settings' ? (
        settings(color)
      ) : (
        <Path
          d={PATHS[name]}
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={name === 'star-filled' || name === 'heart-filled' ? color : 'none'}
        />
      )}
    </Svg>
  );
}

function settings(color: string): ReactNode {
  return (
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
  );
}
