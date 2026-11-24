import clsx from 'clsx';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatRarity,
  nextUpTrophies,
  recentTrophies,
  TIER_MATERIAL,
  TIERS_RAREST_FIRST,
  trophyPercent,
  useTrophyCabinet,
} from '@trackt/client';
import type { TrophyCabinet, TrophyEntry } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Leaderboard } from '../components/trophies/Leaderboard';
import { TrophyMedal } from '../components/trophies/TrophyMedal';
import { TrophyShelf } from '../components/trophies/TrophyShelf';
import { gradient, tierChip, useTrophyCopy } from '../components/trophies/copy';
import { GlassCard } from '../components/ui/GlassCard';
import { useAuthedPage } from '../lib/auth-client';

/** The trophy cabinet (docs/design/Trophies.dc.html): spotlight, two shelves, the leaderboard beside them. */
export const Route = createFileRoute('/trophies')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.trophies') }] }),
  component: TrophiesPage,
});

const RECENT = 6;
const NEXT = 4;

function Summary({ cabinet }: { cabinet: TrophyCabinet }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  return (
    <GlassCard className="grid grid-cols-2 rounded-[18px] sm:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))_1.7fr]">
      <div className="col-span-2 flex flex-col justify-center gap-1.5 px-[22px] py-[18px] sm:col-span-1">
        <span className="font-label text-[10px] font-bold tracking-label text-dim">
          {t('trophies.points')}
        </span>
        <span className="text-prism font-display text-[40px] leading-none">
          {copy.number(cabinet.points)}
        </span>
      </div>
      <div className="col-span-2 grid grid-cols-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.09)] sm:contents sm:shadow-none">
        {TIERS_RAREST_FIRST.map((tier) => (
          <div
            key={tier}
            className="flex flex-col items-center justify-center gap-[7px] px-1.5 py-4 shadow-[inset_1px_0_0_rgb(255_255_255/0.09)]"
          >
            <span aria-hidden className="hx h-4 w-[18px]" style={{ background: tierChip(tier) }} />
            <span className="font-display text-2xl leading-none">{cabinet.tiers[tier]}</span>
            <span className="font-label text-[9px] font-bold tracking-label text-dim">
              {copy.tier(tier)}
            </span>
          </div>
        ))}
      </div>
      <div className="col-span-2 flex flex-col justify-center gap-2 px-[22px] py-[18px] font-label text-[13px] font-bold tracking-[0.06em] shadow-[inset_0_1px_0_rgb(255_255_255/0.09)] sm:col-span-1 sm:shadow-[inset_1px_0_0_rgb(255_255_255/0.09)]">
        <span>
          #{copy.number(cabinet.friendsRank)}{' '}
          <span className="font-semibold text-dim">{t('trophies.rankFriends')}</span>
        </span>
        <span>
          {cabinet.globalMonthRank ? `#${copy.number(cabinet.globalMonthRank)}` : '—'}{' '}
          <span className="font-semibold text-dim">{t('trophies.rankGlobalMonth')}</span>
        </span>
      </div>
    </GlassCard>
  );
}

function ShareButton({ trophy, username }: { trophy: TrophyEntry; username: string }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const share = async () => {
    const url = `${window.location.origin}/users/${encodeURIComponent(username)}`;
    const text = t('trophies.shareText', { name: copy.name(trophy) });
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-live="polite"
      className={clsx(
        'h-11 cursor-pointer rounded-full bg-white/6 px-[22px] text-[13px] font-bold tracking-btn shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] transition hover:shadow-[inset_0_0_0_1px_#d96bb0]',
        state === 'copied' ? 'text-pink' : state === 'failed' ? 'text-red-400' : 'text-fg',
      )}
    >
      {state === 'copied'
        ? t('trophies.shareCopied')
        : state === 'failed'
          ? t('trophies.shareFailed')
          : t('trophies.share')}
    </button>
  );
}

function Spotlight({ trophy, cabinet }: { trophy: TrophyEntry; cabinet: TrophyCabinet }) {
  const { t } = useTranslation();
  const copy = useTrophyCopy();
  const material = TIER_MATERIAL[trophy.tier];
  const locked = trophy.unlockedAt === null;
  const pct = trophyPercent(trophy);
  const stats: [string, string][] = locked
    ? [
        [`${pct}%`, t('trophies.stat.done')],
        [String(trophy.points), t('trophies.stat.points')],
        [formatRarity(trophy.rarity), t('trophies.stat.haveIt')],
      ]
    : [
        [formatRarity(trophy.rarity), t('trophies.stat.haveIt')],
        [String(trophy.points), t('trophies.stat.points')],
        [copy.date(trophy.unlockedAt as string), t('trophies.stat.unlocked')],
      ];

  return (
    <GlassCard
      as="section"
      aria-label={copy.name(trophy)}
      className="grid items-center overflow-hidden rounded-[18px] md:grid-cols-[340px_minmax(0,1fr)]"
    >
      <TrophyMedal trophy={trophy} owner={cabinet.owner.username} />
      <div className="flex min-w-0 flex-col gap-3.5 px-6 pt-2 pb-7 md:py-7 md:pr-8 md:pl-2">
        <div className="flex flex-wrap items-center gap-2.5 font-label text-[11px] font-bold tracking-label">
          <span
            aria-hidden
            className="hx h-[11px] w-3"
            style={{ background: tierChip(trophy.tier) }}
          />
          <span style={{ color: material.fg }}>
            {t('trophies.tierLine', { tier: copy.tier(trophy.tier) })}
          </span>
          <span className="text-dim">·</span>
          <span className="text-[#cfc9d8]">
            {trophy.points} {t('trophies.ptsUnit')}
          </span>
          <span className="text-dim">·</span>
          <span className={locked ? 'text-dim' : 'text-kind-game'}>
            {locked
              ? t('trophies.locked')
              : t('trophies.unlockedOn', { date: copy.date(trophy.unlockedAt as string) })}
          </span>
        </div>
        <h2 className="m-0 font-display text-[clamp(2.25rem,4vw,3.25rem)] leading-none font-normal uppercase">
          {copy.name(trophy)}
        </h2>
        <p className="m-0 max-w-[520px] text-[15px] leading-[1.55] text-muted">
          {copy.description(trophy)}
        </p>
        {locked && (
          <div className="flex max-w-[420px] flex-col gap-2">
            <div className="flex justify-between">
              <span className="font-label text-[10px] font-bold tracking-label text-dim">
                {t('trophies.progress')}
              </span>
              <span className="font-label text-xs font-bold tracking-[0.06em]">
                {copy.progress(trophy)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: gradient(material.chip) }}
              />
            </div>
          </div>
        )}
        <div className="mt-1 grid grid-cols-[repeat(3,minmax(0,120px))]">
          {stats.map(([value, key], i) => (
            <div
              key={key}
              className={clsx(
                'flex flex-col gap-[5px]',
                i > 0 && 'pl-4 shadow-[inset_1px_0_0_rgb(255_255_255/0.1)]',
              )}
            >
              <span className="font-display text-2xl leading-none">{value}</span>
              <span className="font-label text-[9px] font-bold tracking-label text-dim">{key}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-4">
          {!locked && <ShareButton trophy={trophy} username={cabinet.owner.username} />}
          <span className="text-[13px] text-muted">{copy.friendsLine(trophy)}</span>
        </div>
      </div>
    </GlassCard>
  );
}

function Shelf({
  id,
  title,
  hint,
  empty,
  trophies,
  columns,
  selectedId,
  onSelect,
  offset,
}: {
  id: string;
  title: string;
  hint: string;
  empty: string;
  trophies: TrophyEntry[];
  columns: number;
  selectedId: string;
  onSelect: (trophy: TrophyEntry) => void;
  offset: number;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="m-0 font-heading text-[32px] font-normal uppercase">
          {title}
        </h2>
        {trophies.length > 0 && (
          <span className="font-label text-[10px] font-bold tracking-label text-dim">{hint}</span>
        )}
      </div>
      {trophies.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div style={{ minWidth: columns * 96 }}>
            <TrophyShelf
              trophies={trophies}
              columns={columns}
              selectedId={selectedId}
              onSelect={onSelect}
              offset={offset}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function TrophiesPage() {
  const { t } = useTranslation();
  const { isPending, navUser } = useAuthedPage();
  const { data: cabinet, isError } = useTrophyCabinet();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  const recent = cabinet ? recentTrophies(cabinet, RECENT) : [];
  const next = cabinet ? nextUpTrophies(cabinet, NEXT) : [];
  const selected =
    cabinet?.trophies.find((x) => x.id === selectedId) ??
    recent[0] ??
    next[0] ??
    cabinet?.trophies[0];
  const select = (trophy: TrophyEntry) => setSelectedId(trophy.id);

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto grid max-w-[1360px] items-start gap-8 px-4 pt-12 pb-20 sm:px-10 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-wrap items-baseline gap-[18px]">
              <h1 className="m-0 font-display text-display font-normal uppercase">
                {t('trophies.title')}
              </h1>
              {cabinet && (
                <span className="font-label text-[13px] font-bold tracking-[0.08em] text-muted">
                  {t('trophies.unlockedOf', { unlocked: cabinet.unlocked, total: cabinet.total })}
                </span>
              )}
            </div>
            {isError && <p className="text-sm text-muted">{t('trophies.loadError')}</p>}
            {cabinet && selected && (
              <>
                <Summary cabinet={cabinet} />
                <Spotlight trophy={selected} cabinet={cabinet} />
                <Shelf
                  id="h-recent"
                  title={t('trophies.recent.title')}
                  hint={t('trophies.recent.hint')}
                  empty={t('trophies.recent.empty')}
                  trophies={recent}
                  columns={RECENT}
                  selectedId={selected.id}
                  onSelect={select}
                  offset={0}
                />
                <Shelf
                  id="h-next"
                  title={t('trophies.next.title')}
                  hint={t('trophies.next.hint')}
                  empty={t('trophies.next.empty')}
                  trophies={next}
                  columns={NEXT}
                  selectedId={selected.id}
                  onSelect={select}
                  offset={RECENT}
                />
              </>
            )}
          </div>
          <Leaderboard className="lg:sticky lg:top-[100px]" />
        </main>
      </div>
    </div>
  );
}
