import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isLocale, LOCALE_COOKIE, type Locale } from './index';

/**
 * Writes the cookie and switches the instance in place: no reload, no
 * navigation, no locale in the URL. `invalidate()` re-runs `head()`, so the tab
 * title follows the switch instead of staying in the old language.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const router = useRouter();

  const setLocale = (locale: Locale) => {
    if (locale === i18n.language) return;
    void i18n.changeLanguage(locale);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = locale;
    void router.invalidate();
  };

  const locale = isLocale(i18n.language) ? i18n.language : 'en';
  return { locale, setLocale };
}
