import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  normalizeSocialLink,
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type ActivityEntry,
  type ProfileSummary,
  type SocialLinks,
  type SocialPlatform,
  type UpdateProfileBody,
} from '@trackt/shared';
import { FeedbackDialog } from '../components/feedback/FeedbackDialog';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { FavouriteShelves } from '../components/profile/FavouriteShelves';
import { ImportDialog } from '../components/profile/ImportDialog';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { AddFriendDialog } from '../components/social/AddFriendDialog';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { Modal, ModalTitle } from '../components/ui/Modal';
import { Tooltip } from '../components/ui/Tooltip';
import { useAuthedPage } from '../lib/auth-client';
import { useLabels } from '../lib/labels';
import {
  useFriends,
  relativeTime,
  removeAvatar,
  updateProfile,
  uploadAvatar,
  useProfileSummary,
} from '@trackt/client';

export const Route = createFileRoute('/profile')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.profile') }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const labels = useLabels();
  const { isPending, navUser, refetch } = useAuthedPage();
  const { data: summary, isError: loadError } = useProfileSummary();
  const { data: friendsOverview } = useFriends();
  const [editing, setEditing] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [importing, setImporting] = useState(false);

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  /** After an edit: re-pull the summary and the session (nav name/avatar). */
  const applyEdits = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    refetch();
  };

  const activityVerb = (entry: ActivityEntry) =>
    entry.verb === 'checked_in'
      ? labels.trackingVerb(entry.kind, 'past')
      : t(entry.verb === 'rated' ? 'profile.recent.rated' : 'profile.recent.marked');

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        {loadError ? (
          <main className="mx-auto max-w-[1360px] px-10 pt-12">
            <p role="alert" className="text-[15px] text-red-400">
              {t('profile.loadError')}
            </p>
          </main>
        ) : !summary ? (
          <main className="h-40" aria-busy />
        ) : (
          <>
            <ProfileHeader
              user={summary.user}
              stats={summary.stats}
              linkYearStats
              friendsMeta={
                <button
                  type="button"
                  onClick={() => setAddingFriend(true)}
                  className="cursor-pointer hover:text-fg"
                >
                  <span className="font-semibold text-fg">{summary.stats.friendCount}</span>{' '}
                  {t('social.friendLabel', { count: summary.stats.friendCount })}
                  {summary.stats.incomingRequestCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-pink px-1.5 py-0.5 text-[10px] font-bold text-on-prism">
                      {summary.stats.incomingRequestCount}
                    </span>
                  )}
                </button>
              }
              action={
                <div className="flex flex-col items-stretch gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSendingFeedback(true)}
                    className="cursor-pointer rounded-full border border-glass-border bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-muted transition hover:border-pink hover:text-pink"
                  >
                    {t('profile.action.feedback')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImporting(true)}
                    className="cursor-pointer rounded-full border border-glass-border bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-muted transition hover:border-pink hover:text-pink"
                  >
                    {t('profile.action.import')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-fg transition hover:border-pink hover:text-pink"
                  >
                    {t('profile.action.editProfile')}
                  </button>
                </div>
              }
            />

            <main className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-10 pb-20">
              <FavouriteShelves
                favorites={summary.favorites}
                own
                emptyMessage={t('profile.favourites.emptyOwn')}
              />

              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
                <section className="flex flex-col gap-4">
                  <h2 className="font-heading text-[32px] uppercase">
                    {t('profile.recent.title')}
                  </h2>
                  {summary.activity.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {summary.activity.map((entry, index) => (
                        <GlassCard
                          as="li"
                          key={`${entry.verb}-${entry.slug}-${index}`}
                          className="flex items-center gap-3.5 rounded-card-sm px-4.5 py-3.5"
                        >
                          <p className="flex-1 text-sm text-muted">
                            {activityVerb(entry)}{' '}
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
                      {t('profile.recent.emptyOwn')}
                    </GlassCard>
                  )}
                </section>
                <div className="flex flex-col gap-10">
                  <section className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-heading text-[32px] uppercase">{t('social.title')}</h2>
                      <Button variant="ghost" onClick={() => setAddingFriend(true)}>
                        {t('social.addFriend')}
                      </Button>
                    </div>
                    {friendsOverview && friendsOverview.friends.length > 0 ? (
                      <ul className="flex flex-wrap gap-3">
                        {friendsOverview.friends.map((friend) => (
                          <li key={friend.id}>
                            <Link
                              to="/users/$username"
                              params={{ username: friend.username }}
                              className="flex flex-col items-center gap-1.5 text-muted transition hover:text-pink"
                            >
                              <Avatar name={friend.username} src={friend.image} size={44} />
                              <span className="max-w-16 truncate text-xs">{friend.username}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                        {t('social.friendsEmpty')}
                      </GlassCard>
                    )}
                  </section>
                  <section className="flex flex-col gap-4">
                    <h2 className="font-heading text-[32px] uppercase">
                      {t('profile.badges.title')}
                    </h2>
                    <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                      {t('profile.badges.body')}
                    </GlassCard>
                    <GlassCard className="flex items-center justify-between rounded-card-sm px-5 py-4">
                      <span className="font-label text-xs tracking-label text-dim">
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
                    </GlassCard>
                  </section>
                </div>
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
        )}
      </div>
    </div>
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
