import { GlassCard } from '../ui/GlassCard';
import { Bone, SkeletonRegion } from '../ui/Skeleton';

/** A profile while its summary loads: header, stat strip, sections beside the side cards. */
export function ProfileSkeleton({ own = false }: { own?: boolean }) {
  return (
    <SkeletonRegion
      as="main"
      className="mx-auto flex max-w-[1360px] flex-col gap-9 px-4 pt-11 pb-20 sm:px-10"
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center gap-7">
          <Bone className="size-26 rounded-full" />
          <div className="flex min-w-70 flex-1 flex-col gap-3">
            <Bone className="h-12 w-64 max-w-full" />
            <div className="flex gap-4.5">
              <Bone className="h-3 w-24" />
              <Bone className="h-3 w-28" />
              <Bone className="h-3 w-20" />
            </div>
          </div>
          <div className="flex gap-2.5">
            <Bone className="h-11 w-36 rounded-full" />
            <Bone className="h-11 w-24 rounded-full" />
          </div>
        </div>
        <Bone className="h-[62px] rounded-card-sm" />
      </div>

      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-11">
          <div className="flex flex-col gap-4">
            <Bone className="h-8 w-44" />
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Bone key={index} className="aspect-2/3 rounded-cover" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Bone className="h-8 w-32" />
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-3.5 py-3.25 shadow-[inset_0_-1px_0_var(--color-divider)]"
              >
                <Bone className="h-12 w-8 shrink-0 rounded-thumb" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Bone className="h-3.5 w-1/2" />
                  <Bone className="h-2.5 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SideCardSkeleton rows={3} />
          {own && <SideCardSkeleton rows={2} />}
        </div>
      </div>
    </SkeletonRegion>
  );
}

function SideCardSkeleton({ rows }: { rows: number }) {
  return (
    <GlassCard className="flex flex-col gap-4 rounded-card-sm p-5.5">
      <Bone className="h-6 w-24" />
      <Bone className="h-2.5 rounded-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Bone key={index} className="h-3 w-4/5" />
      ))}
    </GlassCard>
  );
}

/** Friend rows in the own-profile card while the friends list loads. */
export function FriendRowsSkeleton({ count }: { count: number }) {
  return (
    <SkeletonRegion as="ul" className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} aria-hidden className="flex items-center gap-3">
          <Bone className="size-9 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className="h-3.5 w-1/2" />
            <Bone className="h-2.5 w-1/3" />
          </div>
        </li>
      ))}
    </SkeletonRegion>
  );
}
