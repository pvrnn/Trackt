import clsx from 'clsx';
import { m } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-sans font-bold tracking-btn transition ' +
  'disabled:cursor-default disabled:border disabled:border-white/8 disabled:bg-white/3 disabled:text-faint';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-prism text-on-prism hover:brightness-115',
  secondary: 'border border-glass-border-strong bg-glass text-fg hover:border-pink hover:text-pink',
  ghost: 'text-muted hover:text-pink',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-6 py-3 text-[13px]',
  lg: 'px-8 py-4 text-sm',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Class builder for button-shaped elements that aren't `<button>` (e.g. links). */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className,
}: ButtonStyleOptions = {}): string {
  return clsx(base, variantClasses[variant], sizeClasses[size], className);
}

export interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <m.button
      whileTap={{ scale: 0.97 }}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}
