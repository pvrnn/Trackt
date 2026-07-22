import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  type ModerationPatchBody,
  type ModerationQueueItem,
  type ModerationQueueQuery,
} from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { KindDot } from '../components/ui/KindDot';
import { useAuthedPage } from '../lib/auth-client';
import { coverGradient } from '../lib/cover';
import { moderateEntry, useModerationQueue } from '../lib/entries';

export const Route = createFileRoute('/moderation')({
  head: () => ({ meta: [{ title: 'Moderation — Trackt' }] }),
  component: ModerationPage,
});

type QueueStatus = ModerationQueueQuery['status'];

/**
 * Per-instance moderation queue (PRD §3.5, §7): user-created entries waiting
 * for review. Moderators approve, reject, or fix fields before approving;
 * the REJECTED tab allows un-rejecting mistakes.
 */
function ModerationPage() {
  const { isPending, navUser, isModerator } = useAuthedPage({ requireModerator: true });
  const [status, setStatus] = useState<QueueStatus>('unverified');
  const { data: items, isError: loadError } = useModerationQueue(status, { enabled: isModerator });

  if (isPending || !navUser || !isModerator) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-10 pt-12 pb-20">
          <div>
            <h1 className="font-display text-[64px] leading-none uppercase">Moderation</h1>
            <p className="mt-2 text-[15px] text-muted">
              Community-created entries. Pending entries are visible only to their creator until
              approved.
            </p>
          </div>

          <div className="flex gap-2.5">
            <Chip selected={status === 'unverified'} onClick={() => setStatus('unverified')}>
              PENDING
            </Chip>
            <Chip selected={status === 'rejected'} onClick={() => setStatus('rejected')}>
              REJECTED
            </Chip>
          </div>

          {loadError ? (
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load the queue — is the instance API reachable?
            </p>
          ) : !items ? null : items.length === 0 ? (
            <p className="text-[15px] text-muted">
              {status === 'unverified'
                ? 'Nothing waiting for review. Nice.'
                : 'No rejected entries.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <QueueCard key={item.id} item={item} status={status} />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

/** One queue entry: summary row, approve/reject, and an inline fix-up form. */
function QueueCard({ item, status }: { item: ModerationQueueItem; status: QueueStatus }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const queryKey = ['moderation', status] as const;

  // Optimistically drop the item from the visible queue; roll back on error,
  // re-sync on settle. No lingering per-card busy flag to get stuck (the bug
  // the hand-rolled version had after a field-only save).
  const moderate = useMutation({
    mutationFn: (patch: ModerationPatchBody) => moderateEntry(item.id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ModerationQueueItem[]>(queryKey);
      // A verdict change moves the item out of this tab; a field-only fix keeps it.
      if (patch.moderation && patch.moderation !== status) {
        queryClient.setQueryData<ModerationQueueItem[]>(queryKey, (current) =>
          current?.filter((entry) => entry.id !== item.id),
        );
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const busy = moderate.isPending;
  const act = (patch: ModerationPatchBody) => moderate.mutate(patch);

  // One count, labelled by kind's part; series/anime may also show a season number (ADR-0003).
  const partLabel = item.kind === 'manga' || item.kind === 'webtoon' ? 'CH' : 'EP';
  const counts = [
    item.seasonNumber !== null ? `SEASON ${item.seasonNumber}` : null,
    item.partCount !== null ? `${item.partCount} ${partLabel}` : null,
  ].filter(Boolean);

  return (
    <GlassCard as="li" className="flex flex-col gap-4 p-5">
      <div className="flex gap-5">
        <div
          aria-hidden
          className="h-[120px] w-[80px] shrink-0 rounded-cover bg-cover bg-center"
          style={
            item.coverUrl
              ? { backgroundImage: `url(${item.coverUrl})` }
              : { background: coverGradient(item.kind, item.title) }
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <KindDot kind={item.kind} showLabel />
            <span className="font-label text-xs tracking-label text-dim">
              {[item.year !== null ? String(item.year) : null, ...counts]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <Link
            to="/media/$slug"
            params={{ slug: item.slug }}
            className="mt-1 block truncate font-display text-[26px] uppercase hover:text-pink"
          >
            {item.title}
          </Link>
          <p className="text-[13px] text-dim">
            by{' '}
            {item.creator ? `@${item.creator.username ?? item.creator.name}` : 'a deleted account'}{' '}
            · {new Date(item.createdAt).toLocaleDateString()}
            {item.genres.length > 0 && ` · ${item.genres.join(', ')}`}
          </p>
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted">{item.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {item.moderation === 'unverified' ? (
            <>
              <Button disabled={busy} onClick={() => act({ moderation: 'verified' })}>
                APPROVE
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => act({ moderation: 'rejected' })}
              >
                REJECT
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => act({ moderation: 'verified' })}>
              APPROVE
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setEditing((value) => !value)}>
            {editing ? 'CLOSE' : 'EDIT'}
          </Button>
        </div>
      </div>

      {moderate.isError && (
        <p role="alert" className="text-sm text-red-400">
          {moderate.error instanceof Error ? moderate.error.message : 'Action failed — try again.'}
        </p>
      )}

      {editing && (
        <EditFields
          item={item}
          busy={busy}
          onSave={(fields) =>
            moderate.mutateAsync(fields).then(
              () => setEditing(false),
              () => undefined,
            )
          }
        />
      )}
    </GlassCard>
  );
}

/** Inline fix-ups a moderator applies before (or without) a verdict. */
function EditFields({
  item,
  busy,
  onSave,
}: {
  item: ModerationQueueItem;
  busy: boolean;
  onSave: (fields: ModerationPatchBody) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [year, setYear] = useState(item.year !== null ? String(item.year) : '');
  const [genres, setGenres] = useState(item.genres.join(', '));
  const [description, setDescription] = useState(item.description ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void onSave({
      title: title.trim(),
      year: year.trim() ? Number(year) : null,
      genres: genres
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean),
      description: description.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-divider pt-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Title"
          name={`title-${item.id}`}
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          required
          className="sm:col-span-2"
        />
        <Input
          label="Year"
          name={`year-${item.id}`}
          type="number"
          min={1850}
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
      </div>
      <Input
        label="Genres"
        name={`genres-${item.id}`}
        placeholder="comma-separated"
        value={genres}
        onChange={(event) => setGenres(event.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`description-${item.id}`}
          className="font-label text-xs font-semibold tracking-label text-dim uppercase"
        >
          Description
        </label>
        <textarea
          id={`description-${item.id}`}
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="resize-none rounded-cover border border-white/12 bg-white/6 px-[18px] py-3.5 font-sans text-[15px] text-fg transition-colors outline-none placeholder:text-faint focus:border-pink/60"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? 'SAVING…' : 'SAVE FIXES'}
        </Button>
      </div>
    </form>
  );
}
