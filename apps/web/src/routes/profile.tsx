import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  normalizeSocialLink,
  SOCIAL_PLATFORM_KEYS,
  SOCIAL_PLATFORMS,
  type ProfileSummary,
  type SocialLinks,
  type SocialPlatform,
  type UpdateProfileBody,
} from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { FavouriteShelves } from '../components/profile/FavouriteShelves';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { AddFriendDialog } from '../components/social/AddFriendDialog';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { Modal, ModalTitle } from '../components/ui/Modal';
import { Tooltip } from '../components/ui/Tooltip';
import { useAuthedPage } from '../lib/auth-client';
import { useFriends } from '../lib/friends';
import { activityVerbLabel, relativeTime } from '../lib/home';
import { removeAvatar, updateProfile, uploadAvatar, useProfileSummary } from '../lib/profile';

export const Route = createFileRoute('/profile')({
  head: () => ({ meta: [{ title: 'Profile — Trackt' }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const queryClient = useQueryClient();
  const { isPending, navUser, refetch } = useAuthedPage();
  const { data: summary, isError: loadError } = useProfileSummary();
  const { data: friendsOverview } = useFriends();
  const [editing, setEditing] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  /** After an edit: re-pull the summary and the session (nav name/avatar). */
  const applyEdits = async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    refetch();
  };

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        {loadError ? (
          <main className="mx-auto max-w-[1360px] px-10 pt-12">
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load your profile — is the instance API reachable?
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
                  {summary.stats.friendCount === 1 ? 'FRIEND' : 'FRIENDS'}
                  {summary.stats.incomingRequestCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-pink px-1.5 py-0.5 text-[10px] font-bold text-on-prism">
                      {summary.stats.incomingRequestCount}
                    </span>
                  )}
                </button>
              }
              action={
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-fg transition hover:border-pink hover:text-pink"
                >
                  EDIT PROFILE
                </button>
              }
            />

            <main className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-10 pb-20">
              <FavouriteShelves
                favorites={summary.favorites}
                own
                emptyMessage="Nothing favourited yet — hit ♡ FAVOURITE on any title’s page and it shows up here, ranked per shelf."
              />

              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
                <section className="flex flex-col gap-4">
                  <h2 className="font-heading text-[32px] uppercase">Recent</h2>
                  {summary.activity.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {summary.activity.map((entry, index) => (
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
                      What you watch and read, your ratings, and status changes show up here.
                    </GlassCard>
                  )}
                </section>
                <div className="flex flex-col gap-10">
                  <section className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-heading text-[32px] uppercase">Friends</h2>
                      <Button variant="ghost" onClick={() => setAddingFriend(true)}>
                        ＋ ADD FRIEND
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
                        No friends yet — search by name or handle to send a request.
                      </GlassCard>
                    )}
                  </section>
                  <section className="flex flex-col gap-4">
                    <h2 className="font-heading text-[32px] uppercase">Badges</h2>
                    <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                      Badges land with the v1.x social layer — streaks, importer feats, cataloguer
                      credits.
                    </GlassCard>
                    <GlassCard className="flex items-center justify-between rounded-card-sm px-5 py-4">
                      <span className="font-label text-xs tracking-label text-dim">
                        PROFILE VISIBILITY
                      </span>
                      <Tooltip label="Anyone with your profile link can view it — no per-user visibility setting yet (ADR-0006)">
                        <span
                          tabIndex={0}
                          className="cursor-help font-label text-xs font-semibold text-dim/60"
                        >
                          PUBLIC
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
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What happens to the avatar when the form is saved. Nothing touches the
 * server until SAVE — a picked file is only previewed locally, so CANCEL
 * genuinely cancels (the old flow uploaded on pick and made CANCEL a lie).
 */
type AvatarChange =
  { kind: 'keep' } | { kind: 'replace'; file: File; previewUrl: string } | { kind: 'remove' };

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
  // an effect rather than assigned during render — a render-phase ref write is
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
     * CANCEL button — the "CANCEL is a lie" state `AvatarChange` exists to
     * prevent. This ordering keeps the failure and the unsaved thing the same
     * thing, and the message below names which half didn't land.
     */
    mutationFn: async ({ body, change }: { body: UpdateProfileBody; change: AvatarChange }) => {
      await updateProfile(body);
      if (change.kind === 'replace') {
        try {
          await uploadAvatar(change.file);
        } catch (cause) {
          throw new Error(
            cause instanceof Error
              ? `Your details saved, but the photo didn’t: ${cause.message}`
              : 'Your details saved, but the photo didn’t upload.',
          );
        }
      } else if (change.kind === 'remove' && user.image) await removeAvatar();
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (saveError) =>
      setError(saveError instanceof Error ? saveError.message : 'Saving failed — try again.'),
  });

  const busy = profileSave.isPending;

  const pickAvatar = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      setError('That image is over 2MB — pick a smaller one.');
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
      setError('Name can’t be empty.');
      return;
    }
    const socialLinks: SocialLinks = {};
    for (const key of SOCIAL_PLATFORM_KEYS) {
      if (!links[key].trim()) continue;
      const url = normalizeSocialLink(key, links[key]);
      if (!url) {
        setError(`${SOCIAL_PLATFORMS[key].label} needs a full https:// URL.`);
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
        <ModalTitle>Edit profile</ModalTitle>

        <div className="flex items-center gap-5">
          <Avatar name={user.username} src={image} size={120} className="size-20 text-2xl" />
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_MIME_TYPES.join(',')}
              className="hidden"
              onChange={(event) => pickAvatar(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {image ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'}
            </Button>
            {image && (
              <button
                type="button"
                disabled={busy}
                onClick={removePhoto}
                className="cursor-pointer text-left text-[13px] text-dim transition hover:text-pink"
              >
                {avatar.kind === 'replace' ? 'Discard new photo' : 'Remove photo'}
              </button>
            )}
            <p className="text-xs text-faint">
              PNG, JPEG, or WebP — 2MB max. Applies when you save.
            </p>
          </div>
        </div>

        <Input
          label="Display name"
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
            Bio
          </label>
          <textarea
            id="bio"
            rows={3}
            maxLength={280}
            value={bio}
            placeholder="Watches too much neo-noir. Reads webtoons on the tram."
            onChange={(event) => setBio(event.target.value)}
            className="resize-none rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
          />
          <p className="text-right text-xs text-faint">{bio.length}/280</p>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1.5 font-label text-xs font-semibold tracking-label text-dim uppercase">
            Social links
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
                  placeholder={SOCIAL_PLATFORMS[key].base ? '@handle or URL' : 'https://…'}
                  onChange={(event) =>
                    setLinks((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="rounded-cover border border-white/12 bg-white/6 px-3 py-2 font-sans text-[13px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-faint">Leave a field empty to unlink it.</p>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            CANCEL
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'SAVING…' : 'SAVE'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
