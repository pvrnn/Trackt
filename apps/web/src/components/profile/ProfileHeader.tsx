import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type ProfileStats,
  type ProfileUser,
} from '@trackt/shared';
import { useFormat } from '../../lib/format';
import { Avatar } from '../ui/Avatar';

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
  /** Controls before SHARE: EDIT PROFILE, or the friend-state action. */
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
  const joinedAt = new Date(user.joinedAt)
    .toLocaleDateString(format.locale, { month: 'short', year: 'numeric' })
    .toUpperCase();
  const yearLink = linkYearStats
    ? ({ to: '/history', search: { year: new Date().getUTCFullYear() } } as const)
    : undefined;

  const cells = [
    { value: String(stats.episodesThisYear), label: t('profile.stats.episodesThisYear'), yearLink },
    { value: String(stats.chaptersThisYear), label: t('profile.stats.chaptersThisYear'), yearLink },
    { value: String(stats.completed), label: t('profile.stats.completed') },
    { value: String(stats.titlesTracked), label: t('profile.stats.titles') },
    {
      value: stats.meanRating !== null ? format.score(stats.meanRating) : 'N/A',
      label: t('profile.stats.meanRating'),
    },
  ];

  return (
    <header className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-7">
        <Avatar
          name={user.username}
          src={user.image}
          size={120}
          className="size-26 font-display text-[44px]"
        />
        <div className="flex min-w-70 flex-1 flex-col gap-2">
          <h1 className="font-heading text-[56px] leading-none uppercase">{user.name}</h1>
          {user.bio && <p className="max-w-[62ch] text-base/normal text-muted">{user.bio}</p>}
          <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2 font-label text-xs font-semibold tracking-[0.08em] text-dim uppercase">
            <span>@{user.username}</span>
            <span>{t('profile.header.joined', { date: joinedAt })}</span>
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
                className="rounded-full border border-glass-border bg-glass px-3 py-1 transition hover:border-pink hover:text-pink"
              >
                {SOCIAL_PLATFORMS[key].label} ↗
              </a>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-2.5">
          {action}
          <ShareButton username={user.username} />
        </div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-card-sm border border-glass-border bg-glass backdrop-blur-[16px] sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((cell) => {
          const body = (
            <>
              <span className="text-prism font-display text-[30px] leading-none">{cell.value}</span>
              <span className="font-label text-[11px] font-semibold tracking-label text-dim uppercase">
                {cell.label}
              </span>
            </>
          );
          const className =
            'flex min-w-0 items-baseline gap-3 px-6 py-4 shadow-[inset_1px_0_0_var(--color-divider)]';
          return cell.yearLink ? (
            <Link
              key={cell.label}
              {...cell.yearLink}
              className={clsx(className, 'transition hover:bg-white/4')}
            >
              {body}
            </Link>
          ) : (
            <div key={cell.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>
    </header>
  );
}

/** Copies the public profile URL, the one a visitor can actually open. */
function ShareButton({ username }: { username: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const share = async () => {
    const url = `${window.location.origin}/users/${encodeURIComponent(username)}`;
    try {
      await navigator.clipboard.writeText(url);
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
        'cursor-pointer rounded-full border border-glass-border-strong bg-glass px-5 py-3 text-[13px] font-bold tracking-btn transition hover:border-pink',
        state === 'copied' ? 'text-pink' : state === 'failed' ? 'text-red-400' : 'text-fg',
      )}
    >
      {state === 'copied'
        ? t('profile.header.shareCopied')
        : state === 'failed'
          ? t('profile.header.shareFailed')
          : t('profile.header.share')}
    </button>
  );
}
