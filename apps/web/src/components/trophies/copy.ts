import { useTranslation } from 'react-i18next';
import { formatRarity, shortDate, TIER_MATERIAL } from '@trackt/client';
import type { TrophyEntry, TrophyTier } from '@trackt/shared';

/** CSS for a list of gradient stops; one stop is a flat colour. */
export function gradient(stops: readonly string[], angle = '135deg'): string {
  return stops.length === 1
    ? (stops[0] as string)
    : `linear-gradient(${angle}, ${stops.join(', ')})`;
}

export const tierChip = (tier: TrophyTier) => gradient(TIER_MATERIAL[tier].chip);

/** The words around a trophy: its name, what it asks, and the line under it on a shelf. */
export function useTrophyCopy() {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.language);
  return {
    number,
    name: (trophy: Pick<TrophyEntry, 'id'>) => t(`trophies.names.${trophy.id}`),
    description: (trophy: Pick<TrophyEntry, 'id'>) => t(`trophies.descriptions.${trophy.id}`),
    tier: (tier: TrophyTier) => t(`trophies.tier.${tier}`),
    tierPoints: (trophy: TrophyEntry) =>
      t('trophies.tierPoints', { tier: t(`trophies.tier.${trophy.tier}`), points: trophy.points }),
    progress: (trophy: TrophyEntry) =>
      t(`trophies.unit.${trophy.unit}`, {
        progress: number(trophy.progress),
        target: number(trophy.target),
      }),
    /** Unlocked: how rare it is. Locked: how far along. */
    sub: (trophy: TrophyEntry) =>
      trophy.unlockedAt
        ? t('trophies.haveIt', { pct: formatRarity(trophy.rarity) })
        : t(`trophies.unit.${trophy.unit}`, {
            progress: number(trophy.progress),
            target: number(trophy.target),
          }),
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
