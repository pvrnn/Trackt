import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { nextUpTrophies, recentTrophies, useTrophyCabinet } from '@trackt/client';
import { GlassCard } from '../ui/GlassCard';
import { Bone, SkeletonRegion } from '../ui/Skeleton';
import { useTrophyCopy } from './copy';
import { TrophyShelf } from './TrophyShelf';

/** The profile's way into the cabinet: three crystals, the points, the standing among friends. */
export function TrophiesCard() {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const { data: cabinet, isLoading } = useTrophyCabinet();
  if (isLoading) return <TrophiesCardSkeleton />;
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

function TrophiesCardSkeleton() {
  return (
    <GlassCard className="flex flex-col gap-2.5 p-[22px]">
      <SkeletonRegion className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <Bone className="h-6 w-28" />
          <Bone className="h-3 w-14" />
        </div>
        <div className="grid h-[84px] grid-cols-3 items-end gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Bone key={index} className="mx-auto h-16 w-11 rounded-lg" />
          ))}
        </div>
        <div className="flex justify-between pt-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.09)]">
          <Bone className="h-3 w-16" />
          <Bone className="h-3 w-24" />
        </div>
      </SkeletonRegion>
    </GlassCard>
  );
}
