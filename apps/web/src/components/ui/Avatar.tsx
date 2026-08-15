import * as AvatarPrimitive from '@radix-ui/react-avatar';
import clsx from 'clsx';
import { avatarGradient } from '@trackt/client';

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

/**
 * Round avatar: uploaded image, or the user's initial on a name-hashed gradient.
 * Radix picks the fallback from the image's real load state — branching on
 * `src` alone rendered a broken-image icon whenever the upload 404'd.
 */
export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  const gradient = avatarGradient(name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <AvatarPrimitive.Root
      title={name}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        sizeClasses[size],
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />}
      {/* delayMs keeps a fast-loading image from flashing the initial first. */}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center"
        style={{ background: gradient.background, color: gradient.color }}
      >
        {initial}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
