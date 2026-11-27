import { useTranslation } from 'react-i18next';

const PULSE = 'animate-pulse rounded bg-glass-well motion-reduce:animate-none';

/** Placeholder tiles shaped like `DiscoverPoster`, for a grid still loading. */
export function DiscoverSkeleton({ className, count = 12 }: { className: string; count?: number }) {
  const { t } = useTranslation();
  return (
    <ul aria-busy aria-label={t('discover.loading')} className={className}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} aria-hidden className="flex min-w-0 flex-col gap-2.5">
          <div className={`aspect-2/3 rounded-[10px] ${PULSE}`} />
          <div className="flex flex-col gap-2">
            <span className={`h-3.5 w-4/5 ${PULSE}`} />
            <span className={`h-2.5 w-1/2 ${PULSE}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}
