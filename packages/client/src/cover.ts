import type { MediaKind } from '@trackt/shared';

/**
 * Deterministic generated covers (design handoff: "seeded by kind + title hash").
 * Pure functions of their inputs — no randomness, no time — so server and client
 * always render the same gradient (hydration-safe).
 */

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Per-kind hue families: violet-blues for movies/series, golds for anime/manga, magentas for webtoons. */
const HUE_RANGES: Record<MediaKind, [number, number]> = {
  movie: [248, 272],
  series: [218, 242],
  anime: [32, 46],
  manga: [22, 36],
  webtoon: [308, 330],
};

function pick(hash: number, shift: number, min: number, max: number): number {
  return min + (((hash >>> shift) % 97) / 97) * (max - min);
}

/**
 * The two stops of a generated cover: saturated dark kind-hue → near-black
 * (design handoff formula).
 *
 * Split out from {@link coverGradient} because React Native has no CSS gradient
 * string to hand to a style — `expo-linear-gradient` takes an array of colours.
 * Both clients therefore derive the same two colours from the same hash, and a
 * title's cover looks identical on web and on device.
 */
export function coverGradientStops(kind: MediaKind, title: string): [string, string] {
  const hash = hashString(`${kind}:${title}`);
  const [hueMin, hueMax] = HUE_RANGES[kind];
  const hue = Math.round(pick(hash, 0, hueMin, hueMax));
  const saturation = Math.round(pick(hash, 8, 42, 58));
  const lightness = Math.round(pick(hash, 16, 38, 46));
  return [`hsl(${hue} ${saturation}% ${lightness}%)`, `hsl(${hue} 45% 6%)`];
}

/** The web form of {@link coverGradientStops}: a `background-image` value. */
export function coverGradient(kind: MediaKind, title: string): string {
  const [from, to] = coverGradientStops(kind, title);
  return `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
}

/** Avatar gradients from the design system: gold→pink and violet→deep-violet. */
const AVATAR_GRADIENTS = [
  { stops: ['#d9a441', '#d96bb0'], color: '#14101a' },
  { stops: ['#8b5cf6', '#3d2a80'], color: '#ffffff' },
  { stops: ['#d96bb0', '#8b5cf6'], color: '#ffffff' },
] as const satisfies readonly { stops: readonly [string, string]; color: string }[];

/** The stops and the legible ink over them, for whichever gradient API the client has. */
export function avatarGradientStops(name: string): (typeof AVATAR_GRADIENTS)[number] {
  const index = hashString(name) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index] ?? AVATAR_GRADIENTS[0];
}

/** The web form: a `background` value plus the text colour that reads on it. */
export function avatarGradient(name: string): { background: string; color: string } {
  const { stops, color } = avatarGradientStops(name);
  return { background: `linear-gradient(135deg, ${stops[0]}, ${stops[1]})`, color };
}
