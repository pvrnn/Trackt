import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PART_KIND_BY_MEDIA,
  type ActivityEntry,
  type InProgressEntry,
  type ProfileStats,
  type ProfileTaste,
} from '@trackt/shared';
import { coverGradient, relativeTime, useHistory } from '@trackt/client';
import { useViewerUsername } from '../../lib/auth-client';
import { useFormat } from '../../lib/format';
import type { HistorySearchParams } from '../../lib/history-search';
import { useLabels } from '../../lib/labels';
import { HistoryTimeline } from '../history/HistoryTimeline';
import { GlassCard } from '../ui/GlassCard';
import { kindDotClass } from '../ui/KindDot';

/**
 * The profile's body sections, shared by the own and the public profile.
 * `username` is the subject's handle on someone else's profile and absent on
 * your own, where reads go to `/me/*`.
 */

const linkClass = 'font-label text-xs font-bold tracking-[0.08em] text-pink hover:text-fg';

function HistoryLink({
  username,
  search,
  children,
}: {
  username: string | undefined;
  search: HistorySearchParams;
  children: ReactNode;
}) {
  const viewer = useViewerUsername();
  const subject = username ?? viewer;
  if (!subject) return null;
  return (
    <Link
      to="/users/$username/history"
      params={{ username: subject }}
      search={search}
      className={linkClass}
    >
      {children}
    </Link>
  );
}

function SectionHeading({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3.5">
      <h2 id={id} className="font-heading text-[32px] uppercase">
        {title}
      </h2>
      {aside}
    </div>
  );
}

export function RightNow({
  entries,
  total,
  username,
}: {
  entries: InProgressEntry[];
  total: number;
  username?: string;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="right-now-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="right-now-heading"
        title={t('profile.rightNow.title')}
        aside={
          <>
            <span className="font-label text-xs font-semibold tracking-[0.08em] text-dim">
              {t('profile.rightNow.count', { shown: entries.length, count: total })}
            </span>
            <span className="flex-1" />
            <HistoryLink username={username} search={{ status: 'in_progress', year: 'all' }}>
              {t('profile.rightNow.all')}
            </HistoryLink>
          </>
        }
      />
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {entries.map((entry) => {
          const partKind = PART_KIND_BY_MEDIA[entry.kind];
          const pct = entry.total ? Math.min(entry.watched / entry.total, 1) : null;
          const where = !partKind
            ? labels.status('in_progress')
            : entry.total
              ? t(`profile.rightNow.${partKind}OfTotal`, {
                  count: entry.watched,
                  total: entry.total,
                })
              : t(`profile.rightNow.${partKind}`, { count: entry.watched });
          return (
            <li key={entry.id} className="min-w-0">
              <Link
                to="/media/$slug"
                params={{ slug: entry.slug }}
                className="flex items-center gap-3.5 rounded-card-sm border border-glass-border bg-glass py-2.5 pr-4 pl-2.5 backdrop-blur-[16px] transition hover:border-pink/55"
              >
                <span
                  aria-hidden
                  className="h-[75px] w-[50px] shrink-0 rounded-[7px] bg-cover bg-center"
                  style={
                    entry.coverUrl
                      ? { backgroundImage: `url(${entry.coverUrl})` }
                      : { background: coverGradient(entry.kind, entry.title) }
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-1.5 font-label text-[10px] font-bold tracking-label text-dim uppercase">
                    <span
                      aria-hidden
                      className={clsx('size-1.5 rounded-full', kindDotClass[entry.kind])}
                    />
                    {labels.kindSingular(entry.kind)}
                  </span>
                  <span className="truncate text-[15px] font-bold">{entry.title}</span>
                  <span className="truncate text-[13px] text-muted">{where}</span>
                  {pct !== null && (
                    <span
                      aria-hidden
                      className="mt-0.75 h-0.75 overflow-hidden rounded-full bg-white/10"
                    >
                      <span
                        className="block h-full rounded-full bg-prism"
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** History's timeline, small: the most recent page, scrolled to today. */
export function ProfileTimeline({ username }: { username?: string }) {
  const { t } = useTranslation();
  // One page of the largest size, not the whole history: the embed is a
  // glance, and OPEN IN HISTORY is the way further back.
  const history = useHistory({ username, limit: 200 });
  if (history.isLoading || history.isError || history.entries.length === 0) return null;
  return (
    <section aria-labelledby="timeline-heading" className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        id="timeline-heading"
        title={t('profile.timeline.title')}
        aside={
          <>
            <span className="font-label text-xs font-semibold tracking-[0.08em] text-dim">
              {t('profile.timeline.hint')}
            </span>
            <span className="flex-1" />
            <HistoryLink username={username} search={{}}>
              {t('profile.timeline.open')}
            </HistoryLink>
          </>
        }
      />
      <HistoryTimeline entries={history.entries} mini />
    </section>
  );
}

export function RecentActivity({
  activity,
  emptyMessage,
  username,
}: {
  activity: ActivityEntry[];
  emptyMessage: string;
  username?: string;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const verb = (entry: ActivityEntry) =>
    entry.verb === 'checked_in'
      ? labels.trackingVerb(entry.kind, 'past')
      : t(entry.verb === 'rated' ? 'profile.recent.rated' : 'profile.recent.marked');

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
      <SectionHeading
        id="recent-heading"
        title={t('profile.recent.title')}
        aside={
          <>
            <span className="flex-1" />
            <HistoryLink username={username} search={{}}>
              {t('profile.recent.fullHistory')}
            </HistoryLink>
          </>
        }
      />
      {activity.length > 0 ? (
        <ul className="flex flex-col">
          {activity.map((entry, index) => (
            <li
              key={`${entry.verb}-${entry.slug}-${index}`}
              className="flex items-center gap-3.5 py-3.25 shadow-[inset_0_-1px_0_var(--color-divider)]"
            >
              <span
                aria-hidden
                className={clsx('size-1.75 shrink-0 rounded-full', kindDotClass[entry.kind])}
              />
              <p className="min-w-0 flex-1 text-[15px] text-muted">
                {verb(entry)}{' '}
                <Link
                  to="/media/$slug"
                  params={{ slug: entry.slug }}
                  className="font-semibold text-fg hover:text-pink"
                >
                  {entry.title}
                </Link>{' '}
                <span className="font-bold text-pink">{entry.detail}</span>
              </p>
              <span className="shrink-0 font-label text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
                {relativeTime(entry.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
          {emptyMessage}
        </GlassCard>
      )}
    </section>
  );
}

const cardClass = 'flex flex-col rounded-card-sm p-5.5';
const cardTitleClass = 'font-heading text-2xl uppercase';
const eyebrowClass = 'font-label text-[11px] font-bold tracking-[0.12em] text-dim';

export function TasteCard({
  taste,
  meanRating,
  emptyMessage,
}: {
  taste: ProfileTaste;
  meanRating: ProfileStats['meanRating'];
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const format = useFormat();
  const tracked = taste.kinds.reduce((sum, entry) => sum + entry.count, 0);
  const topGenre = taste.genres[0]?.count ?? 0;
  const mix = taste.kinds.map((entry) => ({
    ...entry,
    pct: Math.round((entry.count / tracked) * 100),
  }));

  return (
    <GlassCard as="section" aria-labelledby="taste-heading" className={clsx(cardClass, 'gap-5.5')}>
      <h2 id="taste-heading" className={cardTitleClass}>
        {t('profile.taste.title')}
      </h2>
      {tracked === 0 ? (
        <p className="text-sm text-muted">{emptyMessage}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <h3 className={eyebrowClass}>{t('profile.taste.kinds')}</h3>
            <div aria-hidden className="flex h-2.5 gap-0.5">
              {mix.map((entry) => (
                <span
                  key={entry.kind}
                  className={clsx('min-w-1 rounded-[3px]', kindDotClass[entry.kind])}
                  style={{ flex: `${entry.count} 1 0` }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {mix.map((entry) => (
                <li
                  key={entry.kind}
                  className="flex items-center gap-1.5 font-label text-[11px] font-semibold tracking-btn text-muted uppercase"
                >
                  <span
                    aria-hidden
                    className={clsx('size-1.75 shrink-0 rounded-full', kindDotClass[entry.kind])}
                  />
                  <span className="truncate">{labels.kind(entry.kind)}</span>
                  <span className="text-fg">{entry.pct}%</span>
                </li>
              ))}
            </ul>
          </div>

          {taste.genres.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <h3 className={eyebrowClass}>{t('profile.taste.genres')}</h3>
              <ul className="flex flex-col gap-2.5">
                {taste.genres.map((genre) => (
                  <li
                    key={genre.name}
                    className="grid grid-cols-[124px_minmax(0,1fr)_28px] items-center gap-3"
                  >
                    <span className="truncate text-sm font-semibold capitalize">{genre.name}</span>
                    <span aria-hidden className="h-1 rounded-full bg-white/8">
                      <span
                        className="block h-full rounded-full bg-pink"
                        style={{ width: `${Math.round((genre.count / topGenre) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-label text-xs font-semibold text-muted">
                      {genre.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-baseline gap-3 pt-4.5 shadow-[inset_0_1px_0_var(--color-divider)]">
            <span className="font-display text-[30px] leading-none">
              {meanRating !== null ? format.score(meanRating) : 'N/A'}
            </span>
            <span className="font-label text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
              {[
                t('profile.taste.average'),
                t('profile.taste.rated', { count: taste.ratedCount }),
                ...(taste.perfectTens > 0
                  ? [t('profile.taste.perfectTens', { count: taste.perfectTens })]
                  : []),
              ].join(' · ')}
            </span>
          </div>
        </>
      )}
    </GlassCard>
  );
}

export const profileCardClass = cardClass;
export const profileCardTitleClass = cardTitleClass;
