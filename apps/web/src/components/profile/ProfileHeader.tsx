import type { ReactNode } from 'react';
import {
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type ProfileStats,
  type ProfileUser,
} from '@trackt/shared';
import { Avatar } from '../ui/Avatar';
import { StatCard } from '../ui/StatCard';

/**
 * Identity block + stat strip, shared by `/profile` and `/users/$username`
 * (ADR-0006 phase 4). The two pages differ only in what sits in the two
 * slots — the own page edits, the public page befriends — so they're passed
 * in rather than switched on an `isOwn` flag the header would have to
 * interpret.
 *
 * `stats` is the base `ProfileStats`: the own-profile extras
 * (`friendCount`/`incomingRequestCount`) reach the header through
 * `friendsMeta`, since only that page can act on them.
 */
export function ProfileHeader({
  user,
  stats,
  friendsMeta,
  action,
  linkYearStats = false,
}: {
  user: ProfileUser;
  stats: ProfileStats;
  /** The FRIENDS entry in the meta row — a button here, plain text there. */
  friendsMeta: ReactNode;
  /** Top-right control: EDIT PROFILE, or the friend-state action. */
  action: ReactNode;
  /**
   * Point the this-year figures at `/history` — the own profile only. `/history`
   * is `/me/*`: a visitor following the link would land on their own history,
   * not the subject's (ADR-0007 defers friend-visible histories).
   */
  linkYearStats?: boolean;
}) {
  const yearLink = linkYearStats
    ? ({ to: '/history', search: { year: new Date().getUTCFullYear() } } as const)
    : undefined;
  return (
    <div className="border-b border-divider">
      <div className="mx-auto flex max-w-[1360px] items-end gap-8 px-10 pt-14 pb-10">
        <Avatar name={user.username} src={user.image} size={120} />
        <div className="flex flex-1 flex-col gap-2">
          <h1 className="font-heading text-[56px] leading-none uppercase">{user.name}</h1>
          <p className="text-[15px] text-muted">
            @{user.username} · member since{' '}
            {new Date(user.joinedAt).toLocaleDateString('en-GB', {
              month: 'long',
              year: 'numeric',
            })}
            {user.bio ? ` · ${user.bio}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-5 font-label text-[13px] text-dim">
            <span>
              <span className="font-semibold text-fg">{stats.titlesTracked}</span> TITLES TRACKED
            </span>
            {friendsMeta}
            {stats.dayStreak > 0 && (
              <span className="text-pink">● {stats.dayStreak}-DAY STREAK</span>
            )}
            {SOCIAL_PLATFORM_KEYS.filter((key) => user.socialLinks[key]).map((key) => (
              <a
                key={key}
                href={user.socialLinks[key]}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-glass-border bg-glass px-3 py-1 text-xs font-semibold tracking-label transition hover:border-pink hover:text-pink"
              >
                {SOCIAL_PLATFORMS[key].label.toUpperCase()} ↗
              </a>
            ))}
          </div>
        </div>
        {action}
      </div>
      <div className="mx-auto grid max-w-[1360px] grid-cols-2 gap-3 px-10 pb-10 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          value={String(stats.episodesThisYear)}
          label="Episodes this year"
          {...(yearLink ? { link: yearLink } : {})}
        />
        <StatCard
          value={String(stats.chaptersThisYear)}
          label="Chapters this year"
          {...(yearLink ? { link: yearLink } : {})}
        />
        <StatCard value={String(stats.completed)} label="Completed" />
        <StatCard value={String(stats.titlesTracked)} label="Titles tracked" />
        <StatCard
          value={stats.meanRating !== null ? stats.meanRating.toFixed(1) : '—'}
          label="Mean rating"
        />
      </div>
    </div>
  );
}
