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

/** Two-stop cover gradient: saturated dark kind-hue → near-black (design handoff formula). */
export function coverGradient(kind: MediaKind, title: string): string {
  const hash = hashString(`${kind}:${title}`);
  const [hueMin, hueMax] = HUE_RANGES[kind];
  const hue = Math.round(pick(hash, 0, hueMin, hueMax));
  const saturation = Math.round(pick(hash, 8, 42, 58));
  const lightness = Math.round(pick(hash, 16, 38, 46));
  return `linear-gradient(160deg, hsl(${hue} ${saturation}% ${lightness}%) 0%, hsl(${hue} 45% 6%) 100%)`;
}

/** Avatar gradients from the design system: gold→pink and violet→deep-violet. */
const AVATAR_GRADIENTS = [
  { background: 'linear-gradient(135deg, #d9a441, #d96bb0)', color: '#14101a' },
  { background: 'linear-gradient(135deg, #8b5cf6, #3d2a80)', color: '#ffffff' },
  { background: 'linear-gradient(135deg, #d96bb0, #8b5cf6)', color: '#ffffff' },
] as const;

export function avatarGradient(name: string): (typeof AVATAR_GRADIENTS)[number] {
  const index = hashString(name) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index] ?? AVATAR_GRADIENTS[0];
}
