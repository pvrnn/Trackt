import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { nextUpTrophies, recentTrophies, useTrophyCabinet } from '@trackt/client';
import { GlassCard } from '../ui/GlassCard';
import { useTrophyCopy } from './copy';
import { TrophyShelf } from './TrophyShelf';

/** The profile's way into the cabinet: three crystals, the points, the standing among friends. */
export function TrophiesCard() {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const { data: cabinet } = useTrophyCabinet();
  if (!cabinet) return null;

  const recent = recentTrophies(cabinet, 3);
  const shelf = [...recent, ...nextUpTrophies(cabinet, 3 - recent.length)];

  return (
    <GlassCard
      as="section"
      aria-labelledby="trophies-heading"
      className="flex flex-col gap-2.5 p-[22px]"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="trophies-heading" className="m-0 font-heading text-2xl font-normal uppercase">
          {t('trophies.title')}
        </h2>
        <Link
          to="/trophies"
          className="font-label text-[11px] font-bold tracking-[0.08em] text-pink-ink hover:text-pink"
        >
          {t('trophies.card.all', { count: cabinet.total })}
        </Link>
      </div>
      {cabinet.unlocked === 0 && <p className="text-sm text-muted">{t('trophies.card.empty')}</p>}
      <Link to="/trophies" aria-label={t('trophies.card.open')} className="block">
        <TrophyShelf trophies={shelf} columns={3} compact />
      </Link>
      <div className="mt-1 flex items-center justify-between pt-3 font-label text-xs font-bold tracking-[0.06em] shadow-[inset_0_1px_0_rgb(255_255_255/0.09)]">
        <span>
          <span className="text-prism">{copy.number(cabinet.points)}</span>{' '}
          <span className="font-semibold text-dim">{t('trophies.ptsUnit')}</span>
        </span>
        <span>
          #{cabinet.friendsRank}{' '}
          <span className="font-semibold text-dim">{t('trophies.rankAmongFriends')}</span>
        </span>
      </div>
    </GlassCard>
  );
}
