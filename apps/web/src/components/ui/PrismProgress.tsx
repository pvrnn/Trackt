import clsx from 'clsx';

/**
 * The PRISM progress bar. `percent === null` is a job that has not reported a
 * total yet, drawn as a sliding segment rather than a 0% that reads as stalled.
 */
export function PrismProgress({
  percent,
  label,
  className,
}: {
  percent: number | null;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className={clsx('relative h-1 overflow-hidden rounded-full bg-white/8', className)}
    >
      <span
        className={clsx(
          'absolute inset-y-0 left-0 rounded-full bg-prism',
          percent === null && 'prism-indeterminate',
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
