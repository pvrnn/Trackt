import { Link, type LinkProps } from '@tanstack/react-router';
import clsx from 'clsx';
import { GlassCard } from './GlassCard';

export interface StatCardProps {
  value: string;
  label: string;
  /** Makes the whole card a link — a stat that has somewhere to drill into. */
  link?: Pick<LinkProps, 'to' | 'search'>;
}

/** Glass stat card: gradient Anton number + Space Grotesk label. */
export function StatCard({ value, label, link }: StatCardProps) {
  const body = (
    <>
      <span className="text-prism font-display text-3xl">{value}</span>
      <span className="font-label text-xs font-semibold tracking-label text-dim uppercase">
        {label}
      </span>
    </>
  );
  const className = clsx(
    'flex h-full items-baseline justify-between rounded-card-sm px-6 py-4.5',
    link && 'transition hover:border-pink',
  );
  if (!link) return <GlassCard className={className}>{body}</GlassCard>;
  // The Link wraps rather than replacing the card's element: GlassCard's props
  // are a `div`'s, and router links carry typed `to`/`search` it can't accept.
  return (
    <Link {...link} className="block">
      <GlassCard className={className}>{body}</GlassCard>
    </Link>
  );
}
