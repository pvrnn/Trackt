import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { PublicProfile } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { FavouriteShelves } from '../components/profile/FavouriteShelves';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { Button, buttonClassName } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { GlassCard } from '../components/ui/GlassCard';
import { useOptionalSession } from '../lib/auth-client';
import {
  useAcceptFriendRequest,
  usePublicProfile,
  useRemoveFriend,
  useSendFriendRequest,
} from '../lib/friends';
import { activityVerbLabel, relativeTime } from '../lib/home';

/**
 * Someone else's profile (ADR-0006 phase 4). Anonymous-readable, so it takes
 * the `news_.$slug.tsx` optional-session posture — marketing nav signed out,
 * app nav signed in — rather than `useAuthedPage()`. Nothing on the page is
 * gated by friendship; `friendState` only decides what the action button does.
 */
export const Route = createFileRoute('/users/$username')({
  head: () => ({ meta: [{ title: 'Profile — Trackt' }] }),
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { username } = Route.useParams();
  const { isPending: sessionPending, session, navUser } = useOptionalSession();
  const { data: profile, isPending, isError } = usePublicProfile(username);

  if (sessionPending) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        {navUser ? <AppNav user={navUser} /> : <MarketingNav />}
        {isError ? (
          <main className="mx-auto max-w-[1360px] px-10 pt-12">
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load this profile — is the instance API reachable?
            </p>
          </main>
        ) : isPending ? (
          <main className="h-40" aria-busy />
        ) : !profile ? (
          <NoSuchUser username={username} />
        ) : (
          <>
            <ProfileHeader
              user={profile.user}
              stats={profile.stats}
              friendsMeta={
                <span>
                  <span className="font-semibold text-fg">{profile.friendCount}</span>{' '}
                  {profile.friendCount === 1 ? 'FRIEND' : 'FRIENDS'}
                </span>
              }
              action={<FriendAction profile={profile} signedIn={!!session} />}
            />

            <main className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-10 pb-20">
              <FavouriteShelves
                favorites={profile.favorites}
                own={false}
                emptyMessage={`${profile.user.name} hasn’t favourited anything yet.`}
              />

              <section className="flex flex-col gap-4">
                <h2 className="font-heading text-[32px] uppercase">Recent</h2>
                {profile.activity.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {profile.activity.map((entry, index) => (
                      <GlassCard
                        as="li"
                        key={`${entry.verb}-${entry.slug}-${index}`}
                        className="flex items-center gap-3.5 rounded-card-sm px-4.5 py-3.5"
                      >
                        <p className="flex-1 text-sm text-muted">
                          {activityVerbLabel(entry)}{' '}
                          <Link
                            to="/media/$slug"
                            params={{ slug: entry.slug }}
                            className="font-semibold text-fg hover:text-pink"
                          >
                            {entry.title}
                          </Link>{' '}
                          <span className="font-bold text-pink">{entry.detail}</span>
                        </p>
                        <span className="font-label text-xs text-dim">
                          {relativeTime(entry.at)}
                        </span>
                      </GlassCard>
                    ))}
                  </ul>
                ) : (
                  <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                    Nothing tracked publicly yet.
                  </GlassCard>
                )}
              </section>
            </main>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The one control the page adds over `/profile`. Signed out it points at
 * login rather than posting a request the API would 401 — the button is only
 * ever shown when it can actually do what it says.
 */
function FriendAction({ profile, signedIn }: { profile: PublicProfile; signedIn: boolean }) {
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const busy = sendRequest.isPending || accept.isPending || remove.isPending;
  const onError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');

  if (profile.friendState === 'self') {
    return (
      <Link to="/profile" className={buttonClassName({ variant: 'secondary' })}>
        EDIT PROFILE
      </Link>
    );
  }

  if (!signedIn) {
    return (
      <Link to="/login" className={buttonClassName({ variant: 'secondary' })}>
        SIGN IN TO ADD
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {profile.friendState === 'none' && (
        <Button
          disabled={busy}
          aria-busy={sendRequest.isPending}
          onClick={() => {
            setError(null);
            sendRequest.mutate(profile.user.username, { onError });
          }}
        >
          ＋ ADD FRIEND
        </Button>
      )}
      {profile.friendState === 'outgoing' && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-busy={remove.isPending}
          aria-label={`Cancel friend request to @${profile.user.username}`}
          onClick={() => {
            setError(null);
            remove.mutate(profile.userId, { onError });
          }}
        >
          REQUEST SENT ✕
        </Button>
      )}
      {profile.friendState === 'incoming' && (
        <div className="flex items-center gap-2">
          <Button
            disabled={busy}
            aria-busy={accept.isPending}
            onClick={() => {
              setError(null);
              accept.mutate(profile.userId, { onError });
            }}
          >
            ACCEPT REQUEST
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            aria-busy={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate(profile.userId, { onError });
            }}
          >
            DECLINE
          </Button>
        </div>
      )}
      {profile.friendState === 'friends' && (
        <Button variant="secondary" disabled={busy} onClick={() => setConfirmingUnfriend(true)}>
          ✓ FRIENDS
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-red-400">
          {error}
        </p>
      )}
      {confirmingUnfriend && (
        <ConfirmDialog
          title="Remove friend?"
          confirmLabel={remove.isPending ? 'REMOVING…' : 'REMOVE'}
          busy={remove.isPending}
          onCancel={() => setConfirmingUnfriend(false)}
          onConfirm={() => {
            setError(null);
            remove.mutate(profile.userId, {
              onError,
              onSettled: () => setConfirmingUnfriend(false),
            });
          }}
        >
          {profile.user.name} goes back to being a stranger, and any list you share with friends
          only stops being visible to them.
        </ConfirmDialog>
      )}
    </div>
  );
}

function NoSuchUser({ username }: { username: string }) {
  return (
    <main className="mx-auto flex max-w-[760px] flex-col items-center gap-2 px-10 pt-20 pb-20 text-center">
      <p className="font-heading text-[32px] text-faint uppercase">No such user</p>
      <p className="max-w-[420px] text-sm text-muted">
        Nobody on this instance goes by @{username}.
      </p>
      <Link
        to="/search"
        className="mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
      >
        BACK TO SEARCH →
      </Link>
    </main>
  );
}
