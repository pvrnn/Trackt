import { useAcceptFriendRequest, useRemoveFriend, useSendFriendRequest } from '@trackt/client';
import { commitHaptic, errorHaptic } from './haptics';

/**
 * The three friend writes, their haptics, and the one busy flag the two screens
 * that make them share (`friends`, `users/[username]`).
 *
 * They differ only in where a failure surfaces — an inline banner on the roster,
 * a toast on a profile — so `onError` is the caller's, and everything else,
 * including the success haptic, is settled here.
 */
export function useFriendActions(onError: (cause: unknown) => void) {
  const send = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const handlers = {
    onSuccess: () => commitHaptic(),
    onError: (cause: unknown) => {
      errorHaptic();
      onError(cause);
    },
  };

  return {
    send,
    accept,
    remove,
    handlers,
    busy: send.isPending || accept.isPending || remove.isPending,
    sendTo: (username: string) => send.mutate(username, handlers),
    acceptFrom: (userId: string) => accept.mutate(userId, handlers),
    removeFrom: (userId: string) => remove.mutate(userId, handlers),
  };
}
