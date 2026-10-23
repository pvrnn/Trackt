import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en, fr } from './locales/index.js';

/**
 * Locale lives in a cookie, not the URL (ADR-0009): there is no `/fr/…`
 * segment, so public pages have no per-language URLs and no `hreflang`.
 */
export const LOCALE_COOKIE = 'trackt_locale';
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** `Intl` locale for a catalog locale: English dates read `en-GB`, not `en-US`. */
const INTL_LOCALES: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

export function intlLocale(locale: string): string {
  return INTL_LOCALES[locale as Locale] ?? INTL_LOCALES.en;
}

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** One parser for the server's cookie header and the browser's `document.cookie`. */
export function localeFromCookie(cookie: string | undefined): string | undefined {
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== LOCALE_COOKIE) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/**
 * Cookie first, then `Accept-Language` ranked by q-value, then `en`. Shared by
 * both sides of hydration so the server render and the first client render
 * cannot disagree about the language.
 */
export function negotiateLocale(
  cookie: string | undefined,
  acceptLanguage: string | undefined,
): Locale {
  const fromCookie = localeFromCookie(cookie) ?? cookie;
  if (isLocale(fromCookie)) return fromCookie;

  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((param) => param.trim().startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { base: tag.toLowerCase().split('-')[0] ?? '', weight };
    })
    .filter((entry) => Number.isFinite(entry.weight))
    .sort((a, b) => b.weight - a.weight);

  const match = ranked.find((entry) => isLocale(entry.base));
  return match ? (match.base as Locale) : 'en';
}

/**
 * A new instance per request (server) or per app load (client). i18next's
 * module singleton is a locale leak across concurrent SSR requests.
 */
export function createI18n(locale: Locale): I18nInstance {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    resources: { en: { translation: en }, fr: { translation: fr } },
    // Bundled catalogs initialise synchronously, so SSR never suspends.
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
