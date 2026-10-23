import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FriendState } from '@trackt/shared';
import {
  useAcceptFriendRequest,
  useFriends,
  useRemoveFriend,
  useSendFriendRequest,
  useUserSearch,
  useDebounced,
} from '@trackt/client';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { GlassCard } from '../ui/GlassCard';
import { Input } from '../ui/Input';
import { Modal, ModalTitle } from '../ui/Modal';

/** Search-result action label per viewer-relative `friendState`. */
const ACTION_KEY = {
  none: 'social.action.add',
  outgoing: 'social.action.pending',
  incoming: 'social.action.respondBelow',
  friends: 'social.friends',
} as const satisfies Record<Exclude<FriendState, 'self'>, string>;

/**
 * Send/accept/decline friend requests (ADR-0006). Modelled on
 * `media/AddToListDialog.tsx`: rows with a per-row action, inline error,
 * ghost DONE footer. Incoming requests surface at the top so the dialog
 * doubles as the accept/decline inbox; there's no other page for that yet.
 */
export function AddFriendDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: overview, isError } = useFriends();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebounced(query).trim();
  const { data: results, isFetching, isError: searchFailed } = useUserSearch(debounced);
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const anyPending = sendRequest.isPending || accept.isPending || remove.isPending;
  const isAccepting = (id: string) => accept.isPending && accept.variables === id;
  const isRemoving = (id: string) => remove.isPending && remove.variables === id;
  const isSending = (username: string) =>
    sendRequest.isPending && sendRequest.variables === username;

  const onError = () => setError(t('social.errors.save'));

  const send = (username: string) => {
    setError(null);
    sendRequest.mutate(username, { onError });
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-5">
        <ModalTitle>{t('social.title')}</ModalTitle>

        {isError ? (
          <p role="alert" className="text-[15px] text-red-400">
            {t('social.errors.load')}
          </p>
        ) : overview && overview.incoming.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-label text-xs tracking-label text-dim">
              {t('social.requests', { count: overview.incoming.length })}
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
                    aria-busy={isAccepting(request.id)}
                    onClick={() => {
                      setError(null);
                      accept.mutate(request.id, { onError });
                    }}
                  >
                    {t('social.accept')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={anyPending}
                    aria-busy={isRemoving(request.id)}
                    onClick={() => {
                      setError(null);
                      remove.mutate(request.id, { onError });
                    }}
                  >
                    {t('social.decline')}
                  </Button>
                </GlassCard>
              ))}
            </ul>
          </div>
        ) : null}

        <Input
          label={t('social.findPeople')}
          name="userSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('social.searchPlaceholder')}
          autoComplete="off"
        />

        {debounced.length >= 2 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {isFetching && (results === undefined || results.length === 0) ? (
              <li className="h-16" aria-busy />
            ) : searchFailed ? (
              // Not silence: with no results *and* a failed request, rendering
              // nothing (or "no one matches") would state a negative we don't
              // have. Same posture as NavSearch's `failed` branch.
              <li role="alert" className="text-[15px] text-red-400">
                {t('social.errors.searchUnavailable')}
              </li>
            ) : results && results.length === 0 ? (
              <li className="text-[15px] text-muted">
                {t('social.noMatches', { query: debounced })}
              </li>
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
                        aria-busy={isAccepting(result.id)}
                        onClick={() => {
                          setError(null);
                          accept.mutate(result.id, { onError });
                        }}
                      >
                        {t('social.accept')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={anyPending}
                        aria-busy={isRemoving(result.id)}
                        onClick={() => {
                          setError(null);
                          remove.mutate(result.id, { onError });
                        }}
                      >
                        {t('social.decline')}
                      </Button>
                    </>
                  ) : result.friendState === 'outgoing' ? (
                    // A sent request is cancellable, not a dead label: DELETE
                    // /me/friends/:id withdraws it (the same route that
                    // declines and unfriends).
                    <Button
                      variant="secondary"
                      disabled={anyPending}
                      aria-busy={isRemoving(result.id)}
                      aria-label={t('social.cancelRequest', { username: result.username })}
                      onClick={() => {
                        setError(null);
                        remove.mutate(result.id, { onError });
                      }}
                    >
                      {t('social.pendingCancel')}
                    </Button>
                  ) : (
                    <Button
                      variant={result.friendState === 'none' ? 'ghost' : 'secondary'}
                      disabled={result.friendState !== 'none' || anyPending}
                      aria-busy={isSending(result.username)}
                      onClick={() => send(result.username)}
                    >
                      {result.friendState === 'self' ? '' : t(ACTION_KEY[result.friendState])}
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
            {t('social.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
