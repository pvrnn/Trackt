import { formatRarity, shortDate } from '@trackt/client';
import type { TrophyEntry, TrophyTier } from '@trackt/shared';
import { useTranslation } from 'react-i18next';

/** The words around a trophy, as the web cabinet writes them (same fragment, same keys). */
export function useTrophyCopy() {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.language);
  const progress = (trophy: TrophyEntry) =>
    t(`trophies.unit.${trophy.unit}`, {
      progress: number(trophy.progress),
      target: number(trophy.target),
    });
  return {
    number,
    progress,
    name: (trophy: Pick<TrophyEntry, 'id'>) => t(`trophies.names.${trophy.id}`),
    description: (trophy: Pick<TrophyEntry, 'id'>) => t(`trophies.descriptions.${trophy.id}`),
    tier: (tier: TrophyTier) => t(`trophies.tier.${tier}`),
    tierPoints: (trophy: TrophyEntry) =>
      t('trophies.tierPoints', { tier: t(`trophies.tier.${trophy.tier}`), points: trophy.points }),
    sub: (trophy: TrophyEntry) =>
      trophy.unlockedAt
        ? t('trophies.haveIt', { pct: formatRarity(trophy.rarity) })
        : progress(trophy),
    date: (iso: string) => shortDate(iso.slice(0, 10), i18n.language),
    friendsLine: (trophy: TrophyEntry) => {
      const [a, b] = trophy.friends.sample;
      const count = trophy.friends.count;
      if (!a) return t('trophies.friendsHave.none');
      if (!b) return t('trophies.friendsHave.one', { a: a.name });
      if (count === 2) return t('trophies.friendsHave.two', { a: a.name, b: b.name });
      return t('trophies.friendsHave.many', { a: a.name, b: b.name, count: count - 2 });
    },
  };
}
