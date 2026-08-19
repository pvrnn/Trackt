import {
  useAcceptFriendRequest,
  useDebounced,
  useFriends,
  useRemoveFriend,
  useSendFriendRequest,
  useUserSearch,
} from '@trackt/client';
import type { FriendState } from '@trackt/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { commitHaptic, errorHaptic } from '../lib/haptics';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Avatar } from './Avatar';
import { Field } from './Field';
import { Loading } from './Page';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/** Search-result action label per viewer-relative `friendState`. */
const ACTION_LABEL: Record<FriendState, string> = {
  none: '＋ ADD',
  outgoing: 'PENDING ✕',
  incoming: 'ACCEPT',
  friends: '✓ FRIENDS',
  self: 'YOU',
};

/**
 * Send, accept, decline and withdraw friend requests (ADR-0006) — the app's
 * whole social write surface, in one sheet, because there is no other page for
 * an accept/decline inbox yet.
 *
 * Incoming requests sit above the search field: someone opening this because
 * of a badge on the profile stat is here to answer a request, not to search.
 * A sent request stays cancellable rather than becoming a dead PENDING label —
 * `DELETE /me/friends/:id` withdraws it, the same route that declines and
 * unfriends.
 */
export function FriendsSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetController(onClose);
  const { data: overview, isPending, isError } = useFriends();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebounced(query).trim();
  const { data: results, isFetching, isError: searchFailed } = useUserSearch(debounced);
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();

  const anyPending = sendRequest.isPending || accept.isPending || remove.isPending;

  const handlers = {
    onSuccess: () => commitHaptic(),
    onError: (cause: unknown) => {
      errorHaptic();
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
    },
  };

  const act = (state: FriendState, user: { id: string; username: string }) => {
    setError(null);
    if (state === 'none') sendRequest.mutate(user.username, handlers);
    else if (state === 'incoming') accept.mutate(user.id, handlers);
    else if (state === 'outgoing') remove.mutate(user.id, handlers);
  };

  return (
    <Sheet title="Friends" controller={sheet} tall>
      {isError ? (
        <SheetError message="Couldn’t load your friends — try again in a moment." />
      ) : isPending ? (
        <Loading />
      ) : overview.incoming.length > 0 ? (
        <View style={styles.block}>
          <Text style={[type.eyebrow, styles.dim]}>REQUESTS ({overview.incoming.length})</Text>
          {overview.incoming.map((request) => (
            <PersonRow
              key={request.id}
              name={request.name}
              username={request.username}
              image={request.image}
              action={{
                label: 'ACCEPT',
                disabled: anyPending,
                onPress: () => act('incoming', request),
              }}
              secondary={{
                label: 'DECLINE',
                disabled: anyPending,
                onPress: () => {
                  setError(null);
                  remove.mutate(request.id, handlers);
                },
              }}
            />
          ))}
        </View>
      ) : null}

      <Field
        label="Find people"
        value={query}
        placeholder="Search by name or @handle"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
      />

      {debounced.length >= 2 ? (
        <View style={styles.block}>
          {isFetching && (results === undefined || results.length === 0) ? (
            <Loading />
          ) : searchFailed ? (
            // Not silence: with no results *and* a failed request, "no one
            // matches" would state a negative we don't have.
            <SheetError message="People search is unavailable right now — try again in a moment." />
          ) : results && results.length === 0 ? (
            <Text style={[type.body, styles.muted]}>No one matches “{debounced}”.</Text>
          ) : (
            results?.map((result) => (
              <PersonRow
                key={result.id}
                name={result.name}
                username={result.username}
                image={result.image}
                action={{
                  label: ACTION_LABEL[result.friendState],
                  // 'friends' and 'self' have nothing left to do — the label is
                  // the state, and the control says so rather than looking live.
                  disabled:
                    anyPending || result.friendState === 'friends' || result.friendState === 'self',
                  selected: result.friendState !== 'none',
                  onPress: () => act(result.friendState, result),
                }}
                {...(result.friendState === 'incoming'
                  ? {
                      secondary: {
                        label: 'DECLINE',
                        disabled: anyPending,
                        onPress: () => {
                          setError(null);
                          remove.mutate(result.id, handlers);
                        },
                      },
                    }
                  : {})}
              />
            ))
          )}
        </View>
      ) : null}

      {error ? <SheetError message={error} /> : null}

      <PrismButton label="Done" onPress={sheet.dismiss} />
    </Sheet>
  );
}

interface RowAction {
  label: string;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
}

/** Avatar, name, handle, and one or two actions — the shape every row here takes. */
function PersonRow({
  name,
  username,
  image,
  action,
  secondary,
}: {
  name: string;
  username: string;
  image: string | null;
  action: RowAction;
  secondary?: RowAction;
}) {
  return (
    <View style={styles.row}>
      <Avatar name={username} image={image} size={36} />
      <View style={styles.rowText}>
        <Text style={[type.cardTitle, styles.fg]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[type.eyebrow, styles.dim]} numberOfLines={1}>
          @{username}
        </Text>
      </View>
      {secondary ? <RowButton {...secondary} /> : null}
      <RowButton {...action} />
    </View>
  );
}

function RowButton({ label, disabled = false, selected = false, onPress }: RowAction) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
      style={({ pressed }) => [
        styles.action,
        selected ? styles.actionSelected : null,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.button, selected ? styles.pink : styles.fg]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowText: {
    flex: 1,
    gap: space.xs,
  },
  action: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
  },
  actionSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  fg: {
    color: color.fg,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
  pink: {
    color: color.pink,
  },
});
