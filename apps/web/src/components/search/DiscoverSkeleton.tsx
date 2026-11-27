import { useTranslation } from 'react-i18next';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

/** Placeholder tiles shaped like `DiscoverPoster`, for a grid still loading. */
export function DiscoverSkeleton({ className, count = 12 }: { className: string; count?: number }) {
  const { t } = useTranslation();
  return (
    <SkeletonRegion as="ul" label={t('discover.loading')} className={className}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} aria-hidden className="flex min-w-0 flex-col gap-2.5">
          <Bone className="aspect-2/3 rounded-[10px]" />
          <div className="flex flex-col gap-2">
            <Bone className="h-3.5 w-4/5" />
            <Bone className="h-2.5 w-1/2" />
          </div>
        </li>
      ))}
    </SkeletonRegion>
  );
}
