import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DELTA_COLOR,
  formatDelta,
  PODIUM_BLOCKS,
  PODIUM_HEIGHTS,
  PODIUM_ORDER,
  topPercent,
  useLeaderboard,
} from '@trackt/client';
import {
  TROPHY_TIER_POINTS,
  trophyDefinition,
  type Leaderboard as Board,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type LeaderboardScope,
  type TrophyTier,
} from '@trackt/shared';
import { Avatar } from '../ui/Avatar';
import { FilterCell } from '../ui/FilterBar';
import { GlassCard } from '../ui/GlassCard';
import { Bone, SkeletonRegion } from '../ui/Skeleton';
import { gradient, tierChip, useTrophyCopy } from './copy';

const ROW_TIERS: TrophyTier[] = ['prism', 'gold', 'silver'];

function ProfileLink({
  row,
  className,
  style,
  children,
}: {
  row: LeaderboardRow;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Link
      to="/users/$username"
      params={{ username: row.username }}
      className={className}
      style={style}
    >
      {children}
    </Link>
  );
}

function TierCounts({ row }: { row: LeaderboardRow }) {
  return (
    <span className="flex items-center gap-2.5 font-label text-[10px] font-semibold text-muted">
      {ROW_TIERS.map((tier) => (
        <span key={tier} className="inline-flex items-center gap-1">
          <span aria-hidden className="hx h-2 w-[9px]" style={{ background: tierChip(tier) }} />
          {row.tiers[tier]}
        </span>
      ))}
    </span>
  );
}

function Row({ row, rankLabel }: { row: LeaderboardRow; rankLabel: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const delta = formatDelta(row.delta);
  return (
    <ProfileLink
      row={row}
      className={clsx(
        'flex min-h-[60px] items-center gap-3 rounded-[14px] px-3.5 transition-colors hover:bg-white/6',
        row.isViewer ? 'bg-pink-row shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)]' : 'bg-white/3',
      )}
    >
      <span
        className={clsx(
          'w-10 shrink-0 font-label text-xs font-bold tracking-[0.02em]',
          row.isViewer ? 'text-pink-ink' : 'text-muted',
        )}
      >
        {rankLabel}
      </span>
      <Avatar name={row.name} src={row.image} size={36} />
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className="truncate text-sm font-semibold">
          {row.isViewer ? t('trophies.leaderboard.you', { username: row.username }) : row.name}
        </span>
        <TierCounts row={row} />
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-label text-[13px] font-bold tracking-[0.02em]">
          {copy.number(row.points)}
        </span>
        {delta && (
          <span
            className="font-label text-[10px] font-bold tracking-[0.04em]"
            style={{ color: DELTA_COLOR[delta.tone] }}
          >
            {delta.text}
          </span>
        )}
      </div>
    </ProfileLink>
  );
}

function Podium({ rows, rising }: { rows: LeaderboardRow[]; rising: boolean }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  return (
    <div className="pod">
      {PODIUM_ORDER.map((index) => {
        const row = rows[index];
        const block = PODIUM_BLOCKS[index];
        if (!row || !block) return <div key={index} className="w-[94px]" />;
        const first = index === 0;
        return (
          <div
            key={index}
            className="blk p3"
            style={{ height: rising ? 6 : PODIUM_HEIGHTS[index] }}
          >
            <ProfileLink
              row={row}
              className="who hover:brightness-115"
              style={{ opacity: rising ? 0 : 1, pointerEvents: rising ? 'none' : undefined }}
            >
              <span
                className="rounded-full"
                style={{
                  boxShadow: first
                    ? '0 0 0 2px #0e0c10, 0 0 0 4px #e58cc4, 0 0 24px rgb(217 107 176 / 0.6)'
                    : '0 0 0 2px #0e0c10, 0 0 0 3.5px rgb(255 255 255 / 0.35)',
                }}
              >
                <Avatar name={row.name} src={row.image} size={first ? 48 : 40} />
              </span>
              <span className="max-w-full truncate text-xs font-semibold">
                {row.isViewer
                  ? t('trophies.leaderboard.you', { username: row.username })
                  : row.name}
              </span>
              <span className="font-label text-[11px] font-bold tracking-[0.04em] text-[#cfc9d8]">
                {copy.number(row.points)} {t('trophies.ptsUnit')}
              </span>
            </ProfileLink>
            <div className="bt" style={{ background: gradient(block.top, '90deg') }} />
            <div className="bsl" style={{ background: gradient(block.side, '180deg') }} />
            <div className="bsr" style={{ background: gradient(block.side, '180deg') }} />
            <div className="bf" style={{ background: gradient(block.front, '180deg') }}>
              {index + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chase({ board }: { board: Board }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const chase = board.chase;
  if (!chase) return null;
  const target = chase.trophy ? trophyDefinition(chase.trophy) : null;
  const body = target
    ? t('trophies.leaderboard.chaseBody', {
        trophy: copy.name(target),
        tier: copy.tier(target.tier).toLowerCase(),
        pts: TROPHY_TIER_POINTS[target.tier],
        rank: chase.rank,
      })
    : t('trophies.leaderboard.chaseBodyAny', { rank: chase.rank });
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-pink/10 px-4 py-3.5 shadow-[inset_0_0_0_1px_rgb(217_107_176/0.4)]">
      <span aria-hidden className="font-display text-[26px] leading-none text-pink-ink">
        ↑
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="font-label text-[11px] font-bold tracking-[0.08em] uppercase">
          {t('trophies.leaderboard.chaseHead', {
            points: copy.number(chase.points),
            name: chase.rival,
          })}
        </span>
        <span className="text-[13px] leading-[1.4] text-muted">{body}</span>
      </div>
    </div>
  );
}

/** Global / Friends, a period, the podium that rises on every change, then the rest. */
export function Leaderboard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const { data: board, isError } = useLeaderboard(scope, period);
  const [rising, setRising] = useState(true);
  const shown = board?.scope === scope && board.period === period ? board : undefined;

  useEffect(() => {
    if (!shown) return;
    setRising(true);
    const timer = setTimeout(() => setRising(false), 60);
    return () => clearTimeout(timer);
  }, [shown]);

  const rest = shown ? shown.rows.slice(3) : [];
  const lonely = shown?.scope === 'friends' && shown.population === 1;
  const nobody = shown?.scope === 'global' && shown.rows.length === 0;

  return (
    <GlassCard
      as="aside"
      className={clsx('flex flex-col gap-3.5 rounded-[18px] px-5 pt-[22px] pb-5', className)}
    >
      <h2 className="m-0 font-display text-[28px] font-normal uppercase">
        {t('trophies.leaderboard.title')}
      </h2>
      <div className="flex flex-col rounded-[14px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]">
        <div
          role="tablist"
          aria-label={t('trophies.leaderboard.board')}
          className="grid grid-cols-2 gap-1 p-1"
        >
          {(['global', 'friends'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={clsx(
                'h-9 cursor-pointer rounded-lg font-label text-xs font-bold tracking-[0.08em] transition-colors',
                scope === s ? 'bg-fg text-on-prism' : 'text-muted hover:text-fg',
              )}
            >
              {t(`trophies.leaderboard.${s}`)}
            </button>
          ))}
        </div>
        <FilterCell
          className="flex-none shadow-[inset_0_1px_0_rgb(255_255_255/0.09)]"
          label={t('trophies.leaderboard.period')}
          value={period}
          onChange={(v) => setPeriod(v as LeaderboardPeriod)}
          items={(['week', 'month', 'all'] as const).map((p) => ({
            value: p,
            label: t(`trophies.leaderboard.${p}`),
          }))}
        />
      </div>

      {!shown && !isError && <LeaderboardSkeleton />}
      {shown && !lonely && !nobody && <Podium rows={shown.rows} rising={rising} />}
      {lonely && (
        <p className="py-6 text-center text-sm text-muted">{t('trophies.leaderboard.noFriends')}</p>
      )}
      {nobody && (
        <p className="py-6 text-center text-sm text-muted">{t('trophies.leaderboard.empty')}</p>
      )}
      {shown && !lonely && <Chase board={shown} />}

      {shown && !lonely && (
        <div className="flex flex-col gap-1">
          {rest.map((row) => (
            <Row key={row.username + row.rank} row={row} rankLabel={String(row.rank)} />
          ))}
          {shown.viewer && (
            <>
              <div className="flex items-center justify-center gap-2.5 py-1.5">
                <span className="h-px flex-1 bg-white/10" />
                <span className="font-label text-[10px] font-bold tracking-label text-dim">
                  {t('trophies.leaderboard.top', {
                    pct: topPercent(shown.viewer.rank, shown.population),
                    population: copy.number(shown.population),
                  })}
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <Row row={shown.viewer} rankLabel={`#${copy.number(shown.viewer.rank)}`} />
            </>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/** The board's rows while a scope or period loads. */
function LeaderboardSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-1">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-[60px] items-center gap-3 rounded-[14px] bg-white/3 px-3.5"
        >
          <Bone className="h-3 w-6 shrink-0" />
          <span className="w-4 shrink-0" />
          <Bone className="size-9 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className="h-3.5 w-1/2" />
            <Bone className="h-2.5 w-1/3" />
          </div>
          <Bone className="h-3 w-10" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
