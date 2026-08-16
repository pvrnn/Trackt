import { Anton_400Regular } from '@expo-google-fonts/anton/400Regular';
import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';

/**
 * The three families from `docs/design/README.md`, as ttf.
 *
 * `apps/web` gets these from `@fontsource/*` as variable woff2, which React
 * Native cannot load — hence the parallel `@expo-google-fonts/*` deps. There is
 * no variable-weight story here either, so each Archivo weight the design uses
 * is loaded as its own face and `font.body*` names it explicitly. Setting
 * `fontWeight` on a loaded family is a no-op on Android and a synthetic-bold
 * approximation on iOS, so it is never used.
 *
 * Imported by weight subpath, not from the package root. Each root index
 * `require()`s every face it ships, so `from '@expo-google-fonts/archivo'`
 * bundles all nineteen — 2.3 MB of italics the design never asks for.
 */
export const fontAssets = {
  Anton_400Regular,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  SpaceGrotesk_600SemiBold,
} as const;

export const font = {
  /** Anton, uppercase — hero, page titles, section headings, card-list titles. */
  display: 'Anton_400Regular',
  body: 'Archivo_400Regular',
  bodyMedium: 'Archivo_500Medium',
  bodySemibold: 'Archivo_600SemiBold',
  bodyBold: 'Archivo_700Bold',
  /** Space Grotesk 600 — data, eyebrows, chips, button labels. Always tracked out. */
  label: 'SpaceGrotesk_600SemiBold',
} as const;

/**
 * The type scale, already collapsed to phone sizes: web's `clamp()` heroes
 * (52–120px) have no phone equivalent, so `hero` is the bottom of that range
 * rather than a fluid value.
 */
export const type = {
  hero: { fontFamily: font.display, fontSize: 44, lineHeight: 44 },
  title: { fontFamily: font.display, fontSize: 32, lineHeight: 33 },
  section: { fontFamily: font.display, fontSize: 22, lineHeight: 24 },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 23 },
  /** Archivo 700 / 15 — card and row titles (`Mobile System.dc.html` §02). */
  cardTitle: { fontFamily: font.bodyBold, fontSize: 15, lineHeight: 19 },
  /** Anton 26 in the PRISM gradient — the stat numbers, and nothing else. */
  stat: { fontFamily: font.display, fontSize: 26, lineHeight: 28 },
  bodySm: { fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  label: { fontFamily: font.label, fontSize: 12, letterSpacing: 1.2 },
  /** Space Grotesk 600 / 10 / +0.06em — the tab bar only, and the floor of the scale. */
  tabLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: 0.6 },
  eyebrow: { fontFamily: font.label, fontSize: 11, letterSpacing: 1.54 },
  button: { fontFamily: font.label, fontSize: 13, letterSpacing: 0.78 },
} as const;
