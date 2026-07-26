import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { VISIBILITIES, type ListSummary, type Visibility } from '@trackt/shared';
import { AppNav } from '../components/layout/AppNav';
import { AuraBackground } from '../components/layout/AuraBackground';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { GlassCard } from '../components/ui/GlassCard';
import { Input } from '../components/ui/Input';
import { Modal, ModalTitle } from '../components/ui/Modal';
import { Tooltip } from '../components/ui/Tooltip';
import { useAuthedPage } from '../lib/auth-client';
import { coverGradient } from '../lib/cover';
import { updatedLabel, useCreateList, useLists, visibilityLabel } from '../lib/lists';

export const Route = createFileRoute('/lists')({
  head: () => ({ meta: [{ title: 'Lists — Trackt' }] }),
  component: ListsPage,
});

/**
 * The mockup's three scopes. Only MY LISTS has a backing feature: FOLLOWING
 * needs the v1.x follow system and COLLABORATIVE needs a membership table, so
 * both render visibly inert rather than as controls that quietly do nothing.
 */
const SCOPES = [
  { key: 'mine', label: 'MY LISTS', ready: true },
  { key: 'following', label: 'FOLLOWING', ready: false },
  { key: 'collaborative', label: 'COLLABORATIVE', ready: false },
] as const;

/** Human copy for each visibility, including the caveat `followers` currently carries. */
const VISIBILITY_HELP: Record<Visibility, string> = {
  public: 'Anyone with the link can see this list.',
  followers: 'Followers only — until the follow system ships, that means just you.',
  private: 'Only you can see this list.',
};

function ListsPage() {
  const { isPending, navUser } = useAuthedPage();
  const { data: lists, isError } = useLists();
  const [creating, setCreating] = useState(false);

  if (isPending || !navUser) return <div className="min-h-screen bg-ink" />;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <AuraBackground variant="app" />
      <div className="relative">
        <AppNav user={navUser} />
        <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-10 pt-12 pb-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-[64px] leading-none uppercase">Lists</h1>
            <Button onClick={() => setCreating(true)}>＋ NEW LIST</Button>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {SCOPES.map((scope) =>
              scope.ready ? (
                <Chip key={scope.key} selected>
                  {scope.label}
                </Chip>
              ) : (
                <Tooltip key={scope.key} label="Coming soon">
                  <span
                    tabIndex={0}
                    className="cursor-not-allowed rounded-full border border-glass-border bg-glass px-4 py-2 font-label text-xs font-semibold tracking-label text-dim/60"
                  >
                    {scope.label}
                  </span>
                </Tooltip>
              ),
            )}
          </div>

          {isError ? (
            <p role="alert" className="text-[15px] text-red-400">
              Couldn’t load your lists — is the instance API reachable? Try again in a moment.
            </p>
          ) : lists === undefined ? (
            <div className="h-40" aria-busy />
          ) : lists.length === 0 ? (
            <GlassCard className="px-6 py-5 text-[15px] text-muted">
              No lists yet — hit ＋ NEW LIST and start with the handful of titles you’d defend in an
              argument.
            </GlassCard>
          ) : (
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {lists.map((entry) => (
                <li key={entry.id}>
                  <ListCard list={entry} />
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
      {creating && <NewListDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/**
 * A list card: a fan of up to four covers over the title, badges and meta row.
 * The fan uses `coverGradient` directly rather than `CoverCard`, which is locked
 * to a 2/3 aspect with a title overlay — wrong for bare slabs.
 */
function ListCard({ list }: { list: ListSummary }) {
  return (
    <Link to="/lists/$id" params={{ id: list.id }} className="block">
      <GlassCard className="overflow-hidden transition hover:border-pink">
        <div className="flex h-[170px]" aria-hidden>
          {list.covers.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-faint">Empty</div>
          ) : (
            list.covers.map((cover, index) => (
              <div
                key={`${cover.title}-${index}`}
                className="flex-1 border-r border-ink/60 last:border-r-0"
                style={{ background: coverGradient(cover.kind, cover.title) }}
              />
            ))
          )}
        </div>
        <div className="flex flex-col gap-2 px-6 py-5">
          <div className="flex items-center gap-2.5">
            <h2 className="flex-1 font-display text-[22px] leading-tight uppercase">
              {list.title}
            </h2>
            {list.isRanked && <Badge tone="pink">RANKED</Badge>}
            {list.isCollaborative && <Badge tone="muted">COLLAB</Badge>}
          </div>
          {list.description && (
            <p className="text-sm leading-relaxed text-muted">{list.description}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3.5 font-label text-xs tracking-label text-dim">
            <span>
              {list.itemCount} {list.itemCount === 1 ? 'TITLE' : 'TITLES'}
            </span>
            <span>{visibilityLabel(list.visibility)}</span>
            <span>UPDATED {updatedLabel(list.updatedAt)}</span>
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

function Badge({ tone, children }: { tone: 'pink' | 'muted'; children: string }) {
  return (
    <span
      className={
        tone === 'pink'
          ? 'rounded-full border border-pink px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-pink'
          : 'rounded-full border border-white/20 px-2.5 py-0.5 font-label text-[10px] font-bold tracking-label text-muted'
      }
    >
      {children}
    </span>
  );
}

function NewListDialog({ onClose }: { onClose: () => void }) {
  const createList = useCreateList();
  const navigate = Route.useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isRanked, setIsRanked] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    createList.mutate(
      {
        title: title.trim(),
        description: description.trim() || null,
        isRanked,
        visibility,
      },
      {
        onSuccess: (created) => navigate({ to: '/lists/$id', params: { id: created.id } }),
        onError: (cause) => setError(cause.message || 'That didn’t save — try again.'),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <ModalTitle>New list</ModalTitle>

        <Input
          label="Title"
          name="title"
          value={title}
          maxLength={120}
          required
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Best webtoons, ranked"
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="list-description"
            className="font-label text-xs font-semibold tracking-label text-dim uppercase"
          >
            Description
          </label>
          <textarea
            id="list-description"
            value={description}
            maxLength={500}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-card-sm border border-glass-border-strong bg-glass-well px-4 py-3 text-[15px] outline-none placeholder:text-dim focus:border-pink"
            placeholder="What ties these together?"
          />
          <p className="text-right text-xs text-faint">{description.length}/500</p>
        </div>

        <label className="flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={isRanked}
            onChange={(event) => setIsRanked(event.target.checked)}
            className="size-4 accent-pink"
          />
          Ranked — order matters, and I can reorder it
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="font-label text-xs font-semibold tracking-label text-dim uppercase">
            Visibility
          </span>
          <div className="flex flex-wrap gap-2.5">
            {VISIBILITIES.map((value) => (
              <Chip
                key={value}
                type="button"
                selected={visibility === value}
                onClick={() => setVisibility(value)}
              >
                {value.toUpperCase()}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-faint">{VISIBILITY_HELP[visibility]}</p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={createList.isPending}>
            CANCEL
          </Button>
          <Button type="submit" disabled={createList.isPending || title.trim().length === 0}>
            {createList.isPending ? 'CREATING…' : 'CREATE'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
