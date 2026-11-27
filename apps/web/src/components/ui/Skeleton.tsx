import clsx from 'clsx';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from './GlassCard';

const PULSE = 'block animate-pulse bg-glass-well motion-reduce:animate-none';

/**
 * One placeholder shape, sized by `className`. Plain `rounded` unless the
 * caller names a radius: two `rounded-*` utilities on one node resolve by
 * stylesheet order, not by which was written last.
 */
export function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={clsx(PULSE, !/\brounded/.test(className ?? '') && 'rounded', className)}
      style={style}
    />
  );
}

/** The busy region a skeleton stands in: announced once, its bones hidden. */
export function SkeletonRegion({
  as: Tag = 'div',
  label,
  className,
  children,
}: {
  as?: ElementType;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Tag aria-busy aria-label={label ?? t('common.loading')} className={className}>
      {children}
    </Tag>
  );
}

/** `GlassCard` rows (avatar, name, handle, action) for a list loading inside a dialog. */
export function CardRowSkeletons({ count, avatar = false }: { count: number; avatar?: boolean }) {
  return Array.from({ length: count }, (_, index) => (
    <GlassCard
      as="li"
      key={index}
      aria-hidden
      className="flex items-center gap-3 rounded-card-sm px-4 py-3"
    >
      {avatar && <Bone className="size-8 shrink-0 rounded-full" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Bone className="h-4 w-1/2" />
        <Bone className="h-2.5 w-1/4" />
      </div>
      <Bone className="h-9 w-20 rounded-full" />
    </GlassCard>
  ));
}
