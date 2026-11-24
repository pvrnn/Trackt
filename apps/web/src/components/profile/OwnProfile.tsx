import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  normalizeSocialLink,
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type Friend,
  type ProfileSummary,
  type SocialLinks,
  type SocialPlatform,
  type UpdateProfileBody,
} from '@trackt/shared';
import { FeedbackDialog } from '../feedback/FeedbackDialog';
import { AddFriendDialog } from '../social/AddFriendDialog';
import { TrophiesCard } from '../trophies/TrophiesCard';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
import { useLabels } from '../../lib/labels';
import { Favourites } from './Favourites';
import { ImportDialog } from './ImportDialog';
import { ProfileHeader } from './ProfileHeader';
import {
  profileCardClass,
  profileCardTitleClass,
  RecentActivity,
  ProfileTimeline,
  RightNow,
  TasteCard,
} from './ProfileSections';
import {
  useFriends,
  removeAvatar,
  updateProfile,
  uploadAvatar,
  useProfileSummary,
} from '@trackt/client';

/**
 * The viewer's own profile, rendered by `/users/$username` when the handle is
 * theirs. It reads `/me/*` rather than the public profile, so it carries the
 * edit, friends, import and feedback controls a visitor never sees.
 */
export function OwnProfile({ onSessionChange }: { onSessionChange: () => void }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: summary, isError: loadError } = useProfileSummary();
  const { data: friendsOverview } = useFriends();
  const [editing, setEditing] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [importing, setImporting] = useState(false);

  /** After an edit: re-pull the summary and the session (nav name/avatar). */
  const applyEdits = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    onSessionChange();
  };

  return loadError ? (
    <main className="mx-auto max-w-[1360px] px-10 pt-12">
      <p role="alert" className="text-[15px] text-red-400">
        {t('profile.loadError')}
      </p>
    </main>
  ) : !summary ? (
    <main className="h-40" aria-busy />
  ) : (
    <>
      <main className="mx-auto flex max-w-[1360px] flex-col gap-9 px-10 pt-11 pb-20">
        <ProfileHeader
          user={summary.user}
          stats={summary.stats}
          linkYearStats
          friendsMeta={
            <a href="#friends" className="hover:text-fg">
              <span className="text-fg">{summary.stats.friendCount}</span>{' '}
              {t('social.friendLabel', { count: summary.stats.friendCount })}
            </a>
          }
          action={
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-3 text-[13px] font-bold tracking-btn text-fg transition hover:border-pink hover:text-pink"
            >
              {t('profile.action.editProfile')}
            </button>
          }
        />

        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-11">
            <Favourites
              favorites={summary.favorites}
              own
              emptyMessage={t('profile.favourites.emptyOwn')}
            />
            <RightNow entries={summary.inProgress} total={summary.inProgressCount} />
            <ProfileTimeline />
            <RecentActivity
              activity={summary.activity}
              emptyMessage={t('profile.recent.emptyOwn')}
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <TasteCard
              taste={summary.taste}
              meanRating={summary.stats.meanRating}
              emptyMessage={t('profile.taste.emptyOwn')}
            />
            <TrophiesCard />
            <FriendsCard
              friends={friendsOverview?.friends ?? []}
              count={summary.stats.friendCount}
              requests={summary.stats.incomingRequestCount}
              onOpen={() => setAddingFriend(true)}
            />
            <div className="flex items-center justify-between px-1.5 py-1">
              <span className="font-label text-[11px] font-semibold tracking-[0.08em] text-dim">
                {t('profile.visibility.title')}
              </span>
              <Tooltip label={t('profile.visibility.tooltip')}>
                <span
                  tabIndex={0}
                  className="cursor-help font-label text-xs font-semibold text-dim/60"
                >
                  {labels.visibility('public')}
                </span>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-2.5 px-1.5">
              <button
                type="button"
                onClick={() => setImporting(true)}
                className="cursor-pointer rounded-full border border-glass-border bg-glass px-4 py-2 font-label text-[11px] font-bold tracking-[0.08em] text-muted transition hover:border-pink hover:text-pink"
              >
                {t('profile.action.import')}
              </button>
              <button
                type="button"
                onClick={() => setSendingFeedback(true)}
                className="cursor-pointer rounded-full border border-glass-border bg-glass px-4 py-2 font-label text-[11px] font-bold tracking-[0.08em] text-muted transition hover:border-pink hover:text-pink"
              >
                {t('profile.action.feedback')}
              </button>
            </div>
          </aside>
        </div>
      </main>
      {editing && (
        <EditProfileDialog
          user={summary.user}
          onClose={() => setEditing(false)}
          onSaved={applyEdits}
        />
      )}
      {addingFriend && <AddFriendDialog onClose={() => setAddingFriend(false)} />}
      {sendingFeedback && <FeedbackDialog onClose={() => setSendingFeedback(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

const FRIENDS_SHOWN = 4;

/** Own-profile friends: the first few, the rest on demand, and the request inbox. */
function FriendsCard({
  friends,
  count,
  requests,
  onOpen,
}: {
  friends: Friend[];
  count: number;
  requests: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? friends : friends.slice(0, FRIENDS_SHOWN);
  const actionClass =
    'cursor-pointer font-label text-xs font-bold tracking-[0.08em] text-pink hover:text-fg';
  return (
    <GlassCard
      as="section"
      id="friends"
      aria-labelledby="friends-heading"
      className={clsx(profileCardClass, 'scroll-mt-24 gap-4')}
    >
      <div className="flex items-baseline gap-2.5">
        <h2 id="friends-heading" className={profileCardTitleClass}>
          {t('social.title')}
        </h2>
        <span className="font-label text-xs font-semibold text-dim">{count}</span>
        <span className="flex-1" />
        <button type="button" onClick={onOpen} className={actionClass}>
          {t('social.addFriend')}
        </button>
      </div>
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {shown.map((friend) => (
            <li key={friend.id}>
              <Link
                to="/users/$username"
                params={{ username: friend.username }}
                className="flex min-w-0 items-center gap-3 hover:text-pink"
              >
                <Avatar name={friend.username} src={friend.image} size={32} className="size-9" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{friend.name}</span>
                  <span className="truncate text-xs text-dim">@{friend.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('social.friendsEmpty')}</p>
      )}
      {(friends.length > FRIENDS_SHOWN || requests > 0) && (
        <div className="flex flex-wrap items-center gap-3 pt-3.5 shadow-[inset_0_1px_0_var(--color-divider)]">
          {friends.length > FRIENDS_SHOWN && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className={actionClass}
            >
              {expanded
                ? t('profile.friends.showFewer')
                : t('profile.friends.all', { count: friends.length })}
            </button>
          )}
          <span className="flex-1" />
          {requests > 0 && (
            <button
              type="button"
              onClick={onOpen}
              className="cursor-pointer rounded-full border border-gold/50 px-3 py-1.25 font-label text-[11px] font-bold tracking-[0.08em] text-gold transition hover:border-gold"
            >
              {t('profile.friends.requests', { count: requests })}
            </button>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/**
 * What happens to the avatar when the form is saved. Nothing touches the
 * server until SAVE: a picked file is only previewed locally, so CANCEL
 * genuinely cancels (the old flow uploaded on pick and made CANCEL a lie).
 */
type AvatarChange =
  { kind: 'keep' } | { kind: 'replace'; file: File; previewUrl: string } | { kind: 'remove' };

/** Distinguishes the photo-upload half of a save from a failed field save. */
class PhotoUploadError extends Error {}

/** Edit dialog: avatar upload/remove, display name, bio. Username stays fixed. */
function EditProfileDialog({
  user,
  onClose,
  onSaved,
}: {
  user: ProfileSummary['user'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: 'keep' });
  const [links, setLinks] = useState<Record<SocialPlatform, string>>(
    () =>
      Object.fromEntries(
        SOCIAL_PLATFORM_KEYS.map((key) => [key, user.socialLinks[key] ?? '']),
      ) as Record<SocialPlatform, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const image =
    avatar.kind === 'replace' ? avatar.previewUrl : avatar.kind === 'remove' ? null : user.image;

  const discardPreview = (current: AvatarChange) => {
    if (current.kind === 'replace') URL.revokeObjectURL(current.previewUrl);
  };

  // Release the last preview's object URL when the dialog unmounts. Tracked in
  // an effect rather than assigned during render: a render-phase ref write is
  // the one React's concurrent rules single out, and a discarded render would
  // leave the ref pointing at a URL nothing revokes.
  const avatarRef = useRef(avatar);
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);
  useEffect(() => () => discardPreview(avatarRef.current), []);

  const profileSave = useMutation({
    /**
     * Fields first, photo second. The upload is the step that actually fails
     * (2MB limit, slow connections), and running it first left the avatar
     * changed on the server while the dialog still showed an error and a
     * CANCEL button, the "CANCEL is a lie" state `AvatarChange` exists to
     * prevent. This ordering keeps the failure and the unsaved thing the same
     * thing, and the message below names which half didn't land.
     */
    mutationFn: async ({ body, change }: { body: UpdateProfileBody; change: AvatarChange }) => {
      await updateProfile(body);
      if (change.kind === 'replace') {
        try {
          await uploadAvatar(change.file);
        } catch {
          throw new PhotoUploadError();
        }
      } else if (change.kind === 'remove' && user.image) await removeAvatar();
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (saveError) =>
      setError(
        t(
          saveError instanceof PhotoUploadError
            ? 'profile.edit.errors.photoFailed'
            : 'profile.edit.errors.saveFailed',
        ),
      ),
  });

  const busy = profileSave.isPending;

  const pickAvatar = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      setError(t('profile.edit.errors.photoTooBig'));
      return;
    }
    setError(null);
    setAvatar((current) => {
      discardPreview(current);
      return { kind: 'replace', file, previewUrl: URL.createObjectURL(file) };
    });
  };

  const removePhoto = () => {
    setError(null);
    setAvatar((current) => {
      discardPreview(current);
      // Removing a just-picked file falls back to the saved photo; removing
      // the saved photo marks it for deletion on save.
      return current.kind === 'replace' && user.image ? { kind: 'keep' } : { kind: 'remove' };
    });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('profile.edit.errors.nameRequired'));
      return;
    }
    const socialLinks: SocialLinks = {};
    for (const key of SOCIAL_PLATFORM_KEYS) {
      if (!links[key].trim()) continue;
      const url = normalizeSocialLink(key, links[key]);
      if (!url) {
        setError(t('profile.edit.errors.socialUrl', { platform: SOCIAL_PLATFORMS[key].label }));
        return;
      }
      socialLinks[key] = url;
    }
    setError(null);
    profileSave.mutate({
      body: { name: name.trim(), bio: bio.trim() || null, socialLinks },
      change: avatar,
    });
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-5">
        <ModalTitle>{t('profile.edit.title')}</ModalTitle>

        <div className="flex items-center gap-5">
          <Avatar name={user.username} src={image} size={120} className="size-20 text-2xl" />
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_MIME_TYPES.join(',')}
              aria-label={t('profile.edit.photoInput')}
              className="hidden"
              onChange={(event) => pickAvatar(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {image ? t('profile.edit.changePhoto') : t('profile.edit.uploadPhoto')}
            </Button>
            {image && (
              <button
                type="button"
                disabled={busy}
                onClick={removePhoto}
                className="cursor-pointer text-left text-[13px] text-dim transition hover:text-pink"
              >
                {avatar.kind === 'replace'
                  ? t('profile.edit.discardPhoto')
                  : t('profile.edit.removePhoto')}
              </button>
            )}
            <p className="text-xs text-faint">{t('profile.edit.photoHint')}</p>
          </div>
        </div>

        <Input
          label={t('profile.edit.displayName')}
          name="displayName"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="bio"
            className="font-label text-xs font-semibold tracking-label text-dim uppercase"
          >
            {t('profile.edit.bio')}
          </label>
          <textarea
            id="bio"
            rows={3}
            maxLength={280}
            value={bio}
            placeholder={t('profile.edit.bioPlaceholder')}
            onChange={(event) => setBio(event.target.value)}
            className="resize-none rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
          />
          <p className="text-right text-xs text-faint">{bio.length}/280</p>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 font-label text-xs font-semibold tracking-label text-dim uppercase">
            {t('profile.edit.socialLinks')}
          </legend>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {SOCIAL_PLATFORM_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="font-label text-[10px] tracking-label text-faint uppercase">
                  {SOCIAL_PLATFORMS[key].label}
                </span>
                <input
                  type="text"
                  value={links[key]}
                  placeholder={
                    SOCIAL_PLATFORMS[key].base ? t('profile.edit.handlePlaceholder') : 'https://…'
                  }
                  onChange={(event) =>
                    setLinks((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="rounded-cover border border-white/12 bg-white/6 px-3 py-2 font-sans text-[13px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-faint">{t('profile.edit.unlinkHint')}</p>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
