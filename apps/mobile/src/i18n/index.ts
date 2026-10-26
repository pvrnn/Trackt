import * as Localization from 'expo-localization';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en, fr } from './locales/index';

export const LOCALE_STORAGE_KEY = 'trackt.locale';
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const INTL_LOCALES: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

export function intlLocale(locale: string): string {
  return INTL_LOCALES[locale as Locale] ?? INTL_LOCALES.en;
}

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function deviceLocale(): Locale {
  const code = Localization.getLocales()[0]?.languageCode?.toLowerCase();
  return isLocale(code) ? code : 'en';
}

export function createI18n(locale: Locale): I18nInstance {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    resources: { en: { translation: en }, fr: { translation: fr } },
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}

// Initial instance from the device locale; the stored override, if any, is
// applied by the root layout after SecureStore has been read.
export const i18n = createI18n(deviceLocale());
