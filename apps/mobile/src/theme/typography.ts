import { Anton_400Regular } from '@expo-google-fonts/anton/400Regular';
import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';

/**
 * The three families, as ttf — React Native cannot load web's variable woff2,
 * so each weight is its own face and `fontWeight` is never used (a no-op on
 * Android, synthetic bold on iOS).
 *
 * **Imported by weight subpath, never from the package root**: each root index
 * `require()`s every face it ships — 2.3 MB of italics the design never asks for.
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
 * Android pads a text box by the font's own ascent and descent on top of the
 * line box, and Space Grotesk's are not symmetric, so an all-caps label centred
 * by flexbox lands half a point low. The four label styles live inside
 * something centred; the rest set an explicit `lineHeight` instead.
 */
const flush = { includeFontPadding: false } as const;

/**
 * The line height every Anton style must use. iOS keeps the baseline one
 * descent (0.33em) above the bottom of a line box shorter than the font's own
 * and clips what rises past the top, so with Anton's 0.86em caps anything under
 * ~1.19em shears the tops off the letters.
 */
export function displayLine(fontSize: number): number {
  return Math.ceil(fontSize * 1.2);
}

/** The type scale at phone sizes; `hero` is the bottom of web's fluid range. */
export const type = {
  hero: { fontFamily: font.display, fontSize: 44, lineHeight: displayLine(44) },
  /** §02 and §08: page title 34. */
  title: { fontFamily: font.display, fontSize: 34, lineHeight: displayLine(34) },
  /** §08 section scale: 24. */
  section: { fontFamily: font.display, fontSize: 24, lineHeight: displayLine(24) },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 23 },
  /** `body` for a `TextInput`: iOS sinks a single-line input's text when it has a `lineHeight`. */
  input: { fontFamily: font.body, fontSize: 15 },
  /** Archivo 700 / 15 — card and row titles (`Mobile System.dc.html` §02). */
  cardTitle: { fontFamily: font.bodyBold, fontSize: 15, lineHeight: 19 },
  /** Anton 26 in the PRISM gradient — the stat numbers, and nothing else. */
  stat: { fontFamily: font.display, fontSize: 26, lineHeight: displayLine(26) },
  bodySm: { fontFamily: font.body, fontSize: 13, lineHeight: 20 },
  label: { fontFamily: font.label, fontSize: 12, letterSpacing: 1.2, ...flush },
  /** Space Grotesk 600 / 10 / +0.06em — the tab bar only, and the floor of the scale. */
  tabLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: 0.6, ...flush },
  eyebrow: { fontFamily: font.label, fontSize: 11, letterSpacing: 1.54, ...flush },
  button: { fontFamily: font.label, fontSize: 13, letterSpacing: 0.78, ...flush },
} as const;
