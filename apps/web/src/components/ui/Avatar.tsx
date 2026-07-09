import clsx from 'clsx';
import { avatarGradient } from '../../lib/cover';

export interface AvatarProps {
  name: string;
  size?: 32 | 44 | 120;
  className?: string;
}

const sizeClasses = {
  32: 'size-8 text-[13px]',
  44: 'size-11 text-base',
  120: 'size-30 text-4xl',
} as const;

/** Round gradient avatar with the user's initial, gradient picked by name hash. */
export function Avatar({ name, size = 32, className }: AvatarProps) {
  const gradient = avatarGradient(name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      title={name}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        sizeClasses[size],
        className,
      )}
      style={{ background: gradient.background, color: gradient.color }}
    >
      {initial}
    </span>
  );
}
