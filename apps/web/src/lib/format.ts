import { useTranslation } from 'react-i18next';
import { formatNewsDate, formatScore, shortDate, updatedLabel } from '@trackt/client';
import { intlLocale } from '../i18n';

/**
 * Locale-aware display helpers for web. `packages/client` keeps the formatting
 * (and its `en-GB` default for mobile); this hook supplies the locale and the
 * translated words around it.
 */
export function useFormat() {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);

  return {
    locale,
    score: (value: number) => formatScore(value, locale),
    newsDate: (iso: string) => formatNewsDate(iso, locale),
    shortDate: (isoDate: string) => shortDate(isoDate, locale),
    dateRange: (startedAt: string | null, finishedAt: string | null) => {
      if (startedAt === null && finishedAt === null) return null;
      if (startedAt === null) return t('date.until', { date: shortDate(finishedAt!, locale) });
      if (finishedAt === null) return t('date.from', { date: shortDate(startedAt, locale) });
      if (startedAt === finishedAt) return shortDate(startedAt, locale);
      return `${shortDate(startedAt, locale)} → ${shortDate(finishedAt, locale)}`;
    },
    updated: (iso: string) =>
      updatedLabel(iso, Date.now(), {
        justNow: t('time.justNow'),
        today: t('time.today'),
        yesterday: t('time.yesterday'),
        daysAgo: (days) => t('time.daysAgo', { days }),
        weeksAgo: (weeks) => t('time.weeksAgo', { weeks }),
        monthsAgo: (months) => t('time.monthsAgo', { months }),
      }),
  };
}
