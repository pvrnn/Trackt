import { useEffect, useState } from 'react';
import type { FriendState } from '@trackt/shared';
import {
  useAcceptFriendRequest,
  useFriends,
  useRemoveFriend,
  useSendFriendRequest,
  useUserSearch,
} from '../../lib/friends';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';

/** Search-result action label per viewer-relative `friendState`. */
const ACTION_LABEL: Record<FriendState, string> = {
  none: '＋ ADD',
  outgoing: 'PENDING',
  incoming: 'RESPOND BELOW',
  friends: '✓ FRIENDS',
  self: '',
};

/**
 * Send/accept/decline friend requests (ADR-0006). Modelled on
 * `media/AddToListDialog.tsx`: rows with a per-row action, inline error,
 * ghost DONE footer. Incoming requests surface at the top so the dialog
 * doubles as the accept/decline inbox — there's no other page for that yet.
 */
export function AddFriendDialog({ onClose }: { onClose: () => void }) {
  const { data: overview, isError } = useFriends();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isFetching } = useUserSearch(debounced);
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const anyPending = sendRequest.isPending || accept.isPending || remove.isPending;
  const isAccepting = (id: string) => accept.isPending && accept.variables === id;
  const isRemoving = (id: string) => remove.isPending && remove.variables === id;
  const isSending = (username: string) =>
    sendRequest.isPending && sendRequest.variables === username;

  const onError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');

  const send = (username: string) => {
    setError(null);
    sendRequest.mutate(username, { onError });
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-5">
        <ModalTitle>Friends</ModalTitle>

        {isError ? (
          <p role="alert" className="text-[15px] text-red-400">
            Couldn’t load your friends — try again in a moment.
          </p>
        ) : overview && overview.incoming.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-label text-xs tracking-label text-dim">
              REQUESTS ({overview.incoming.length})
            </h3>
            <ul className="flex flex-col gap-2">
              {overview.incoming.map((request) => (
                <GlassCard
                  as="li"
                  key={request.id}
                  className="flex items-center gap-3 rounded-card-sm px-4 py-3"
                >
                  <Avatar name={request.username} src={request.image} size={32} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{request.name}</span>
                    <span className="truncate text-xs text-dim">@{request.username}</span>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={anyPending}
                    onClick={() => {
                      setError(null);
                      accept.mutate(request.id, { onError });
                    }}
                  >
                    {isAccepting(request.id) ? '…' : 'ACCEPT'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={anyPending}
                    onClick={() => {
                      setError(null);
                      remove.mutate(request.id, { onError });
                    }}
                  >
                    {isRemoving(request.id) ? '…' : 'DECLINE'}
                  </Button>
                </GlassCard>
              ))}
            </ul>
          </div>
        ) : null}

        <Input
          label="Find people"
          name="userSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or @handle"
          autoComplete="off"
        />

        {debounced.length >= 2 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {isFetching && (results === undefined || results.length === 0) ? (
              <li className="h-16" aria-busy />
            ) : results && results.length === 0 ? (
              <li className="text-[15px] text-muted">No one matches “{debounced}”.</li>
            ) : (
              results?.map((result) => (
                <GlassCard
                  as="li"
                  key={result.id}
                  className="flex items-center gap-3 rounded-card-sm px-4 py-3"
                >
                  <Avatar name={result.username} src={result.image} size={32} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{result.name}</span>
                    <span className="truncate text-xs text-dim">@{result.username}</span>
                  </div>
                  {result.friendState === 'incoming' ? (
                    <>
                      <Button
                        variant="secondary"
                        disabled={anyPending}
                        onClick={() => {
                          setError(null);
                          accept.mutate(result.id, { onError });
                        }}
                      >
                        {isAccepting(result.id) ? '…' : 'ACCEPT'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={anyPending}
                        onClick={() => {
                          setError(null);
                          remove.mutate(result.id, { onError });
                        }}
                      >
                        {isRemoving(result.id) ? '…' : 'DECLINE'}
                      </Button>
                    </>
                  ) : result.friendState === 'outgoing' ? (
                    // A sent request is cancellable, not a dead label: DELETE
                    // /me/friends/:id withdraws it (the same route that
                    // declines and unfriends).
                    <Button
                      variant="secondary"
                      disabled={anyPending}
                      aria-label={`Cancel friend request to @${result.username}`}
                      onClick={() => {
                        setError(null);
                        remove.mutate(result.id, { onError });
                      }}
                    >
                      {isRemoving(result.id) ? '…' : 'PENDING ✕'}
                    </Button>
                  ) : (
                    <Button
                      variant={result.friendState === 'none' ? 'ghost' : 'secondary'}
                      disabled={result.friendState !== 'none' || anyPending}
                      onClick={() => send(result.username)}
                    >
                      {isSending(result.username) ? '…' : ACTION_LABEL[result.friendState]}
                    </Button>
                  )}
                </GlassCard>
              ))
            )}
          </ul>
        )}

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
