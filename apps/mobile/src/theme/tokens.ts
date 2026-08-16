/**
 * AURA PRISM tokens, ported for React Native (ADR-0008 §5).
 *
 * This is the second copy of the values in `docs/design/README.md` — the first
 * is `apps/web/src/styles.css`, which cites the same handoff. NativeWind was
 * rejected, so there is no shared class layer to keep them honest; the guard is
 * `test/theme/tokens.test.ts`, which parses the hex values back out of
 * `styles.css` and fails when the two drift.
 *
 * Keys mirror the CSS custom-property names (`--color-on-prism` → `onPrism`)
 * so that guard is a mechanical comparison rather than a hand-maintained map.
 */

export const color = {
  ink: '#0e0c10',
  fg: '#f0edf4',
  muted: '#b8b1c4',
  dim: '#948da1',
  faint: '#6a6478',
  pink: '#d96bb0',
  gold: '#d9a441',
  onPrism: '#14101a',
  kindMovie: '#8b5cf6',
  kindSeries: '#4a6ee8',
  kindAnime: '#d9a441',
  kindManga: '#e8874a',
  kindWebtoon: '#d96bb0',
} as const;

/**
 * The translucent surfaces. Kept apart from `color` because they are `rgba()`
 * rather than hex and so sit outside the drift guard — and because on native
 * they are composited over `expo-blur` rather than `backdrop-filter`.
 */
export const surface = {
  glass: 'rgba(255,255,255,0.05)',
  glassWell: 'rgba(255,255,255,0.07)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassBorderStrong: 'rgba(255,255,255,0.15)',
  divider: 'rgba(255,255,255,0.09)',
  pinkSelected: 'rgba(217,107,176,0.18)',
  pinkRow: 'rgba(217,107,176,0.12)',
} as const;

/** The one signature gradient: primary action, wordmark, hero stats only. */
export const PRISM = [color.gold, color.pink, color.kindMovie] as const;

/**
 * The three aura radials, as fractions of the layer they are painted into so
 * `<AuraBackground>` can scale them to any screen. `web` is the `radial-gradient`
 * they transcribe; `opacity` is the app variant, and the `auth`/marketing panels
 * multiply it (design README: "up to 0.55 on marketing/login panels").
 */
export const AURA = [
  { color: color.kindMovie, cx: 0.1, cy: -0.1, rx: 1.05, ry: 0.68, opacity: 0.35 },
  { color: color.pink, cx: 1, cy: 0.15, rx: 0.93, ry: 0.62, opacity: 0.28 },
  { color: color.gold, cx: 0.3, cy: 1.15, rx: 0.99, ry: 0.74, opacity: 0.3 },
] as const;

/** Radii. Pills are `999`, not a percentage — RN has no `border-radius: 999px` clamp quirk. */
export const radius = {
  pill: 999,
  card: 16,
  cardSm: 14,
  cover: 12,
  thumb: 6,
} as const;

/** The 4px scale the web layout falls on, named rather than inlined. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 40,
} as const;
