import { GlassCard } from './GlassCard';

export interface StatCardProps {
  value: string;
  label: string;
}

/** Glass stat card: gradient Anton number + Space Grotesk label. */
export function StatCard({ value, label }: StatCardProps) {
  return (
    <GlassCard className="flex items-baseline justify-between rounded-card-sm px-6 py-4.5">
      <span className="text-prism font-display text-3xl">{value}</span>
      <span className="font-label text-xs font-semibold tracking-label text-dim uppercase">
        {label}
      </span>
    </GlassCard>
  );
}
