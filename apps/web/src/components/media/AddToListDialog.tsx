import { useState } from 'react';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';
import { listsApi, useCreateList, useLists, useListsInvalidator } from '@trackt/client';

/**
 * Add or remove a title across the viewer's lists (PRD §3.4). `containsMedia`
 * comes back on each summary, so membership is server-stated rather than
 * inferred — a list edited in another tab still shows the truth here.
 */
export function AddToListDialog({
  mediaId,
  mediaTitle,
  onClose,
}: {
  mediaId: string;
  mediaTitle: string;
  onClose: () => void;
}) {
  const { data: lists, isError } = useLists(mediaId);
  const createList = useCreateList();
  const invalidate = useListsInvalidator();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const toggle = async (listId: string, contains: boolean) => {
    setPending(listId);
    setError(null);
    try {
      if (contains) await listsApi.removeItem(listId, mediaId);
      else await listsApi.addItem(listId, mediaId);
      invalidate(listId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
    } finally {
      setPending(null);
    }
  };

  const createAndAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    createList.mutate(
      { title, description: null, isRanked: false, visibility: 'public' },
      {
        onSuccess: async (created) => {
          setNewTitle('');
          await toggle(created.id, false);
        },
        onError: (cause) => setError(cause.message || 'That didn’t save — try again.'),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <ModalTitle>Add to list</ModalTitle>
          {/* Which title is being added was only in the old aria-label; on screen
              the heading alone is ambiguous once the dialog covers the page. */}
          <p className="mt-1 text-sm text-muted">{mediaTitle}</p>
        </div>

        {isError ? (
          <p role="alert" className="text-[15px] text-red-400">
            Couldn’t load your lists — try again in a moment.
          </p>
        ) : lists === undefined ? (
          <div className="h-24" aria-busy />
        ) : lists.length === 0 ? (
          <p className="text-[15px] text-muted">
            No lists yet — name one below and this title goes straight into it.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {lists.map((entry) => {
              const contains = entry.containsMedia === true;
              return (
                <GlassCard
                  as="li"
                  key={entry.id}
                  className="flex items-center gap-3 rounded-card-sm px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{entry.title}</span>
                    <span className="font-label text-xs tracking-label text-dim">
                      {entry.itemCount} {entry.itemCount === 1 ? 'TITLE' : 'TITLES'}
                    </span>
                  </div>
                  <Button
                    variant={contains ? 'secondary' : 'ghost'}
                    disabled={pending !== null}
                    onClick={() => toggle(entry.id, contains)}
                  >
                    {pending === entry.id ? '…' : contains ? '✓ ADDED' : '＋ ADD'}
                  </Button>
                </GlassCard>
              );
            })}
          </ul>
        )}

        <form onSubmit={createAndAdd} className="flex items-end gap-3">
          <Input
            label="New list"
            name="newList"
            value={newTitle}
            maxLength={120}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="Name a new list"
            className="flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={createList.isPending || newTitle.trim().length === 0}
          >
            {createList.isPending ? 'CREATING…' : 'CREATE & ADD'}
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            DONE
          </Button>
        </div>
      </div>
    </Modal>
  );
}
