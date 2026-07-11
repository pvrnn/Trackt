import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AVATAR_MIME_TYPES,
  MEDIA_KINDS,
  type MediaKind,
  type ProfileSummary,
} from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { CoverCard } from '../components/media/CoverCard';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { KindDot } from '../components/ui/KindDot';
import { StatCard } from '../components/ui/StatCard';
import { authClient } from '../lib/auth-client';
import { relativeTime } from '../lib/home';
import { fetchProfileSummary, removeAvatar, updateProfile, uploadAvatar } from '../lib/profile';

export const Route = createFileRoute('/profile')({
  head: () => ({ meta: [{ title: 'Profile — Trackt' }] }),
  component: ProfilePage,
});

const VERB_LABELS: Record<ProfileSummary['activity'][number]['verb'], string> = {
  checked_in: 'Checked in',
  rated: 'Rated',
  status: 'Marked',
};

const KIND_BLOCK_TITLES: Record<MediaKind, string> = {
  movie: 'Favourite movies',
  series: 'Favourite series',
  anime: 'Favourite anime',
  manga: 'Favourite manga',
  webtoon: 'Favourite webtoons',
};

function ProfilePage() {
  const navigate = useNavigate();
  const { data: session, isPending, refetch } = authClient.useSession();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);

  // Same client-side session guard as the other app pages.
  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' });
  }, [isPending, session, navigate]);

  useEffect(() => {
    if (session) fetchProfileSummary().then(setSummary, () => setLoadError(true));
  }, [session]);

  if (isPending || !session) return <div className="min-h-screen bg-ink" />;

  const navUser = {
    name: session.user.name,
    username: session.user.displayUsername ?? session.user.name,
    image: session.user.image,
  };

  /** After an edit: re-pull the summary and the session (nav name/avatar). */
  const applyEdits = async () => {
    setSummary(await fetchProfileSummary());
    refetch();
  };

  const favoriteBlocks = summary
    ? MEDIA_KINDS.map((kind) => ({
        kind,
        items: summary.favorites.filter((entry) => entry.kind === kind),
      })).filter((block) => block.items.length > 0)
    : [];

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
            {/* header */}
            <div className="border-b border-divider">
              <div className="mx-auto flex max-w-[1360px] items-end gap-8 px-10 pt-14 pb-10">
                <Avatar name={summary.user.username} src={summary.user.image} size={120} />
                <div className="flex flex-1 flex-col gap-2">
                  <h1 className="font-display text-[56px] leading-none uppercase">
                    {summary.user.name}
                  </h1>
                  <p className="text-[15px] text-muted">
                    @{summary.user.username} · member since{' '}
                    {new Date(summary.user.joinedAt).toLocaleDateString('en-GB', {
                      month: 'long',
                      year: 'numeric',
                    })}
                    {summary.user.bio ? ` · ${summary.user.bio}` : ''}
                  </p>
                  <div className="flex gap-5 font-label text-[13px] text-dim">
                    <span>
                      <span className="font-semibold text-fg">{summary.stats.titlesTracked}</span>{' '}
                      TITLES TRACKED
                    </span>
                    {summary.stats.dayStreak > 0 && (
                      <span className="text-pink">● {summary.stats.dayStreak}-DAY STREAK</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="cursor-pointer rounded-full border border-glass-border-strong bg-glass px-6 py-[11px] text-[13px] font-bold tracking-btn text-fg transition hover:border-pink hover:text-pink"
                >
                  EDIT PROFILE
                </button>
              </div>
              <div className="mx-auto grid max-w-[1360px] grid-cols-2 gap-3 px-10 pb-10 md:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  value={String(summary.stats.episodesThisYear)}
                  label="Episodes this year"
                />
                <StatCard
                  value={String(summary.stats.chaptersThisYear)}
                  label="Chapters this year"
                />
                <StatCard value={String(summary.stats.completed)} label="Completed" />
                <StatCard value={String(summary.stats.titlesTracked)} label="Titles tracked" />
                <StatCard
                  value={
                    summary.stats.meanRating !== null ? summary.stats.meanRating.toFixed(1) : '—'
                  }
                  label="Mean rating"
                />
              </div>
            </div>

            <main className="mx-auto flex max-w-[1360px] flex-col gap-10 px-10 pt-10 pb-20">
              {favoriteBlocks.length > 0 ? (
                favoriteBlocks.map((block) => (
                  <section key={block.kind} className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-[32px] uppercase">
                        {KIND_BLOCK_TITLES[block.kind]}
                      </h2>
                      <KindDot kind={block.kind} />
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {block.items.map((entry) => (
                        <Link key={entry.id} to="/media/$slug" params={{ slug: entry.slug }}>
                          <div className="relative">
                            <CoverCard
                              kind={entry.kind}
                              title={entry.title}
                              coverUrl={entry.coverUrl ?? undefined}
                            />
                            <span className="absolute top-2.5 left-2.5 rounded-full bg-ink/80 px-2.5 py-0.5 font-display text-sm text-pink">
                              {String(entry.rank).padStart(2, '0')}
                            </span>
                          </div>
                        </Link>
                      ))}
                      <Link
                        to="/search"
                        search={{ kind: block.kind }}
                        title="Find more to favourite"
                        className="flex aspect-2/3 items-center justify-center rounded-cover border border-dashed border-white/20 text-2xl text-faint transition hover:border-pink hover:text-pink"
                      >
                        ＋
                      </Link>
                    </div>
                  </section>
                ))
              ) : (
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Favourites</h2>
                  <GlassCard className="px-6 py-5 text-[15px] text-muted">
                    Nothing favourited yet — hit ♡ FAVOURITE on any title’s page and it shows up
                    here, ranked per shelf.
                  </GlassCard>
                </section>
              )}

              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_1fr]">
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Recent</h2>
                  {summary.activity.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {summary.activity.map((entry, index) => (
                        <GlassCard
                          as="li"
                          key={`${entry.verb}-${entry.slug}-${index}`}
                          className="flex items-center gap-3.5 rounded-card-sm px-4.5 py-3.5"
                        >
                          <p className="flex-1 text-sm text-muted">
                            {VERB_LABELS[entry.verb]}{' '}
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
                      Your check-ins, ratings, and status changes show up here.
                    </GlassCard>
                  )}
                </section>
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-[32px] uppercase">Badges</h2>
                  <GlassCard className="rounded-card-sm px-5 py-4 text-sm text-muted">
                    Badges land with the v1.x social layer — streaks, importer feats, cataloguer
                    credits.
                  </GlassCard>
                  <GlassCard className="flex items-center justify-between rounded-card-sm px-5 py-4">
                    <span className="font-label text-xs tracking-label text-dim">
                      PROFILE VISIBILITY
                    </span>
                    <span
                      title="Coming soon — profiles are private until the social layer"
                      className="cursor-not-allowed font-label text-xs font-semibold text-dim/60"
                    >
                      PRIVATE
                    </span>
                  </GlassCard>
                </section>
              </div>
            </main>
            {editing && (
              <EditProfileDialog
                user={summary.user}
                onClose={() => setEditing(false)}
                onSaved={applyEdits}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

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
  const [image, setImage] = useState(user.image);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setImage(await uploadAvatar(file));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dropAvatar = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeAvatar();
      setImage(null);
    } catch {
      setError('Could not remove the photo — try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name can’t be empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ name: name.trim(), bio: bio.trim() || null });
      await onSaved();
      onClose();
    } catch {
      setError('Saving failed — try again.');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="edit profile"
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <GlassCard as="section" className="w-full max-w-md bg-ink/90 p-7">
        <form onSubmit={save} className="flex flex-col gap-5">
          <h2 className="font-display text-[28px] uppercase">Edit profile</h2>

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
                  onClick={dropAvatar}
                  className="cursor-pointer text-left text-[13px] text-dim transition hover:text-pink"
                >
                  Remove photo
                </button>
              )}
              <p className="text-xs text-faint">PNG, JPEG, or WebP — 2MB max.</p>
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
      </GlassCard>
    </div>
  );
}
