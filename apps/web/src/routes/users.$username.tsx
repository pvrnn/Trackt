import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicProfile } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingNav } from '../components/layout/MarketingNav';
import { Favourites } from '../components/profile/Favourites';
import { NoSuchUser } from '../components/profile/NoSuchUser';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import {
  ProfileTimeline,
  RecentActivity,
  RightNow,
  TasteCard,
} from '../components/profile/ProfileSections';
import { Button, buttonClassName } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useOptionalSession } from '../lib/auth-client';
import {
  useAcceptFriendRequest,
  usePublicProfile,
  useRemoveFriend,
  useSendFriendRequest,
} from '@trackt/client';

/**
 * Someone else's profile (ADR-0006 phase 4). Anonymous-readable, so it takes
 * the `news_.$slug.tsx` optional-session posture (marketing nav signed out,
 * app nav signed in) rather than `useAuthedPage()`. Nothing on the page is
 * gated by friendship; `friendState` only decides what the action button does.
 */
export const Route = createFileRoute('/users/$username')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.profile') }] }),
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { t } = useTranslation();
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
              {t('profile.public.loadError')}
            </p>
          </main>
        ) : isPending ? (
          <main className="h-40" aria-busy />
        ) : !profile ? (
          <NoSuchUser username={username} />
        ) : (
          <main className="mx-auto flex max-w-[1360px] flex-col gap-9 px-10 pt-11 pb-20">
            <ProfileHeader
              user={profile.user}
              stats={profile.stats}
              friendsMeta={
                <span>
                  <span className="text-fg">{profile.friendCount}</span>{' '}
                  {t('social.friendLabel', { count: profile.friendCount })}
                </span>
              }
              action={<FriendAction profile={profile} signedIn={!!session} />}
            />

            <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-11">
                <Favourites
                  favorites={profile.favorites}
                  own={false}
                  emptyMessage={t('profile.favourites.emptyOther', { name: profile.user.name })}
                />
                <RightNow
                  entries={profile.inProgress}
                  total={profile.inProgressCount}
                  username={profile.user.username}
                />
                <ProfileTimeline username={profile.user.username} />
                <RecentActivity
                  activity={profile.activity}
                  emptyMessage={t('profile.recent.emptyPublic')}
                  username={profile.user.username}
                />
              </div>
              <aside className="flex min-w-0 flex-col gap-4">
                <TasteCard
                  taste={profile.taste}
                  meanRating={profile.stats.meanRating}
                  emptyMessage={t('profile.taste.emptyOther', { name: profile.user.name })}
                />
              </aside>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

/**
 * The one control the page adds over `/profile`. Signed out it points at
 * login rather than posting a request the API would 401; the button is only
 * ever shown when it can actually do what it says.
 */
function FriendAction({ profile, signedIn }: { profile: PublicProfile; signedIn: boolean }) {
  const { t } = useTranslation();
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const busy = sendRequest.isPending || accept.isPending || remove.isPending;
  const onError = () => setError(t('social.errors.save'));

  if (profile.friendState === 'self') {
    return (
      <Link to="/profile" className={buttonClassName({ variant: 'secondary' })}>
        {t('profile.action.editProfile')}
      </Link>
    );
  }

  if (!signedIn) {
    return (
      <Link to="/login" className={buttonClassName({ variant: 'secondary' })}>
        {t('social.signInToAdd')}
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
          {t('social.addFriend')}
        </Button>
      )}
      {profile.friendState === 'outgoing' && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-busy={remove.isPending}
          aria-label={t('social.cancelRequest', { username: profile.user.username })}
          onClick={() => {
            setError(null);
            remove.mutate(profile.userId, { onError });
          }}
        >
          {t('social.requestSent')}
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
            {t('social.acceptRequest')}
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
            {t('social.decline')}
          </Button>
        </div>
      )}
      {profile.friendState === 'friends' && (
        <Button variant="secondary" disabled={busy} onClick={() => setConfirmingUnfriend(true)}>
          {t('social.friends')}
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-56 text-right text-xs text-red-400">
          {error}
        </p>
      )}
      {confirmingUnfriend && (
        <ConfirmDialog
          title={t('social.unfriend.title')}
          confirmLabel={remove.isPending ? t('social.unfriend.removing') : t('common.remove')}
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
          {t('social.unfriend.body', { name: profile.user.name })}
        </ConfirmDialog>
      )}
    </div>
  );
}
