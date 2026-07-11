import clsx from 'clsx';
import { avatarGradient } from '../../lib/cover';

export interface AvatarProps {
  name: string;
  /** Uploaded avatar URL; falls back to the gradient initial when absent. */
  src?: string | null;
  size?: 32 | 44 | 120;
  className?: string;
}

const sizeClasses = {
  32: 'size-8 text-[13px]',
  44: 'size-11 text-base',
  120: 'size-30 text-4xl',
} as const;

/** Round avatar: uploaded image, or the user's initial on a name-hashed gradient. */
export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  const gradient = avatarGradient(name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      title={name}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        sizeClasses[size],
        className,
      )}
      style={src ? undefined : { background: gradient.background, color: gradient.color }}
    >
      {src ? <img src={src} alt={name} className="size-full object-cover" /> : initial}
    </span>
  );
}
