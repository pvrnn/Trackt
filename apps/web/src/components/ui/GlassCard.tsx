import clsx from 'clsx';
import type { ComponentPropsWithRef, ElementType } from 'react';

export interface GlassCardProps extends ComponentPropsWithRef<'div'> {
  as?: ElementType;
}

/** Glass panel: the recurring surface of the design system. */
export function GlassCard({ as: Tag = 'div', className, ...props }: GlassCardProps) {
  return (
    <Tag
      className={clsx(
        'rounded-card border border-glass-border bg-glass backdrop-blur-[16px]',
        className,
      )}
      {...props}
    />
  );
}
