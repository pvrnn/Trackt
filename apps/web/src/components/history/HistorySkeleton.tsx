import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

/** Bars at fixed offsets: [left %, width %, row]. Stable, so the placeholder never jitters. */
const BARS: [number, number, number][] = [
  [6, 22, 0],
  [34, 14, 1],
  [52, 30, 0],
  [18, 26, 2],
  [62, 12, 2],
  [80, 16, 1],
];

/** `HistoryTimeline`'s frame with a few bars in it, while its entries load. */
export function TimelineSkeleton({ mini = false, label }: { mini?: boolean; label?: string }) {
  return (
    <SkeletonRegion
      label={label}
      className={clsx(
        'flex min-w-0 flex-col bg-white/4 ring-1 ring-glass-border backdrop-blur-[16px] ring-inset',
        mini ? 'rounded-card-sm' : 'rounded-[18px]',
      )}
    >
      {!mini && (
        <div className="flex items-center gap-[18px] px-[18px] py-3.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.09)]">
          {Array.from({ length: 6 }, (_, index) => (
            <Bone key={index} className="h-3 w-14" />
          ))}
          <span className="flex-1" />
          <Bone className="h-[38px] w-28 rounded-full" />
        </div>
      )}
      <div className={clsx('relative', mini ? 'h-[150px]' : 'h-[260px]')}>
        {BARS.map(([left, width, row], index) => (
          <Bone
            key={index}
            className="absolute h-5 rounded-full"
            style={{ left: `${left}%`, width: `${width}%`, top: 24 + row * 34 }}
          />
        ))}
        <Bone className="absolute inset-x-4 bottom-10 h-1 rounded-full" />
      </div>
    </SkeletonRegion>
  );
}

/** One group of `HistoryCard`s while the grid loads. */
export function HistoryGridSkeleton({ label }: { label?: string }) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5">
        <Bone className="h-7 w-20" />
        <Bone className="h-2.5 w-14" />
        <span aria-hidden className="h-px flex-1 bg-divider" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-4 gap-y-[26px]">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-2.5">
            <Bone className="aspect-[2/3] rounded-[10px]" />
            <Bone className="h-3.5 w-4/5" />
            <Bone className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** The history page before the profile behind it has loaded. */
export function HistoryPageSkeleton() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 pt-12 pb-20 sm:px-10">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="font-heading text-[64px] leading-none uppercase">{t('history.title')}</h1>
        <Bone className="mb-2.5 h-3.5 w-48" />
      </div>
      <Bone className="h-[120px] rounded-card" />
      <TimelineSkeleton />
    </main>
  );
}
