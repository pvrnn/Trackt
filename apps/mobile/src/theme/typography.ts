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
 * What the four label styles add, and the display and body ones do not need.
 *
 * Android pads a text box by the font's own ascent and descent *on top of* the
 * line box, and Space Grotesk's are not symmetric — so an all-caps label
 * centred by flexbox lands off-centre, half a point low in a 25pt pill. These
 * four are the styles that live inside something centred (a pill, a chip, a
 * button); the rest set an explicit `lineHeight`, which fixes the box a
 * different way. Ignored on iOS, which never added the padding.
 */
const flush = { includeFontPadding: false } as const;

/** The type scale at phone sizes; `hero` is the bottom of web's fluid range. */
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
  label: { fontFamily: font.label, fontSize: 12, letterSpacing: 1.2, ...flush },
  /** Space Grotesk 600 / 10 / +0.06em — the tab bar only, and the floor of the scale. */
  tabLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: 0.6, ...flush },
  eyebrow: { fontFamily: font.label, fontSize: 11, letterSpacing: 1.54, ...flush },
  button: { fontFamily: font.label, fontSize: 13, letterSpacing: 0.78, ...flush },
} as const;
