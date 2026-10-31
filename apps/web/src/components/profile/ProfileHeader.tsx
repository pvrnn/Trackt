import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type ProfileStats,
  type ProfileUser,
} from '@trackt/shared';
import { useFormat } from '../../lib/format';
import { Avatar } from '../ui/Avatar';
import { StatCard } from '../ui/StatCard';

/**
 * Identity block + stat strip, shared by `/profile` and `/users/$username`
 * (ADR-0006 phase 4). The two pages differ only in what sits in the two
 * slots (the own page edits, the public page befriends) so they're passed
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
  /** The FRIENDS entry in the meta row: a button here, plain text there. */
  friendsMeta: ReactNode;
  /** Top-right control: EDIT PROFILE, or the friend-state action. */
  action: ReactNode;
  /**
   * Point the this-year figures at `/history` (the own profile only). `/history`
   * is `/me/*`: a visitor following the link would land on their own history,
   * not the subject's (ADR-0007 defers friend-visible histories).
   */
  linkYearStats?: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const joinedAt = new Date(user.joinedAt).toLocaleDateString(format.locale, {
    month: 'long',
    year: 'numeric',
  });
  const yearLink = linkYearStats
    ? ({ to: '/history', search: { year: new Date().getUTCFullYear() } } as const)
    : undefined;
  return (
    <div className="border-b border-divider">
      {/* Wraps rather than squeezes: the action column (EDIT PROFILE, IMPORT)
          has to stay on screen on a narrow viewport, where the identity block
          and it cannot share a line. */}
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-end gap-8 px-10 pt-14 pb-10">
        <Avatar name={user.username} src={user.image} size={120} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="font-heading text-[56px] leading-none uppercase">{user.name}</h1>
          <p className="text-[15px] text-muted">
            {t('profile.header.memberSince', { username: user.username, date: joinedAt })}
            {user.bio ? ` · ${user.bio}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-5 font-label text-[13px] text-dim">
            <span>
              <span className="font-semibold text-fg">{stats.titlesTracked}</span>{' '}
              {t('profile.header.titlesTracked')}
            </span>
            {friendsMeta}
            {stats.dayStreak > 0 && (
              <span className="text-pink">
                ● {t('profile.header.streak', { count: stats.dayStreak })}
              </span>
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
          label={t('profile.stats.episodesThisYear')}
          {...(yearLink ? { link: yearLink } : {})}
        />
        <StatCard
          value={String(stats.chaptersThisYear)}
          label={t('profile.stats.chaptersThisYear')}
          {...(yearLink ? { link: yearLink } : {})}
        />
        <StatCard value={String(stats.completed)} label={t('profile.stats.completed')} />
        <StatCard value={String(stats.titlesTracked)} label={t('profile.stats.titles')} />
        <StatCard
          value={stats.meanRating !== null ? format.score(stats.meanRating) : 'N/A'}
          label={t('profile.stats.meanRating')}
        />
      </div>
    </div>
  );
}
