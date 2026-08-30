import { useDebounced, useFriends, useUserSearch } from '@trackt/client';
import type { FriendState, UserSummary } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PersonRow, RosterTab, friendStateNote } from '../../src/components/PersonRow';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { Icon } from '../../src/components/Icon';
import { BackLink, EmptyState, Loading, PageFrame } from '../../src/components/Page';
import { AnimatedPressable, ripple } from '../../src/components/Press';
import { commitHaptic } from '../../src/lib/haptics';
import { useFriendActions } from '../../src/lib/friends';
import { useInstance } from '../../src/lib/instance-provider';
import { useAuthedScreen } from '../../src/lib/session';
import { color, layout, radius, space, stroke, surface, text } from '../../src/theme/tokens';
import { type } from '../../src/theme/typography';

/** Which slice of the roster is showing; a query overrides all three. */
type Tab = 'friends' | 'requests' | 'sent';

/**
 * Friends, as a screen (`Mobile App.dc.html` — "FRIENDS · PUSHED FROM PROFILE
 * ROW"), replacing the sheet this used to be.
 *
 * A sheet was the wrong container: this is a roster you scan, search and act on
 * repeatedly, and sheets are for one decision. Pushing it also gives the search
 * field the whole screen instead of the top of a 60% panel, and lets a row lead
 * somewhere — tapping a person opens their profile, which the sheet could not
 * do without dismissing itself first.
 *
 * The design's three tabs are FRIENDS / REQUESTS / SUGGESTED. There is no
 * suggestion engine here and inventing one would mean inventing the data, so
 * the third tab is **SENT** — the outgoing requests the overview already
 * carries, which is also the mockup's own `REQUESTED` card state and the only
 * place a request can be withdrawn.
 */
export default function FriendsScreen() {
  const { user } = useAuthedScreen();
  const insets = useSafeAreaInsets();
  const { origin } = useInstance();
  const { data: overview, isPending, isError } = useFriends();

  const [tab, setTab] = useState<Tab>('friends');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unfriending, setUnfriending] = useState<UserSummary | null>(null);

  const debounced = useDebounced(query).trim();
  const searching = debounced.length >= 2;
  const { data: results, isFetching, isError: searchFailed } = useUserSearch(debounced);

  const friendActions = useFriendActions((cause) =>
    setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.'),
  );
  const { busy } = friendActions;

  const act = (state: FriendState, person: UserSummary) => {
    setError(null);
    if (state === 'none') friendActions.sendTo(person.username);
    else if (state === 'incoming') friendActions.acceptFrom(person.id);
    else if (state === 'outgoing') friendActions.removeFrom(person.id);
    else if (state === 'friends') setUnfriending(person);
  };

  const decline = (person: UserSummary) => {
    setError(null);
    friendActions.removeFrom(person.id);
  };

  /** An invite is a link to your own profile — the one URL a friend can act on. */
  const invite = () => {
    void Share.share({
      message: `Track what you watch and read with me on Trackt: ${origin ?? ''}/users/${user?.username ?? ''}`,
    });
  };

  const rows: { person: UserSummary; state: FriendState; note: string }[] = searching
    ? (results ?? []).map((result) => ({
        person: result,
        state: result.friendState,
        note: friendStateNote(result.friendState),
      }))
    : !overview
      ? []
      : tab === 'friends'
        ? overview.friends.map((friend) => ({
            person: friend,
            state: 'friends' as const,
            note: 'FRIENDS',
          }))
        : tab === 'requests'
          ? overview.incoming.map((request) => ({
              person: request,
              state: 'incoming' as const,
              note: 'WANTS TO BE FRIENDS',
            }))
          : overview.outgoing.map((request) => ({
              person: request,
              state: 'outgoing' as const,
              note: 'REQUEST SENT',
            }));

  return (
    <PageFrame>
      <View style={[styles.head, { paddingTop: insets.top + space.md }]}>
        <BackLink />
        <Text style={styles.title}>FRIENDS</Text>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Invite a friend"
          onPress={invite}
          android_ripple={ripple(true)}
          style={styles.invite}
        >
          <LinearGradient
            colors={[color.pink, color.kindMovie]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.inviteFill}
          >
            <Icon name="share" color={color.onPrism} size={17} />
          </LinearGradient>
        </AnimatedPressable>
      </View>

      <View style={styles.controls}>
        <View style={styles.search}>
          <Icon name="search" color={color.dim} size={16} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Name or @handle"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[type.body, styles.searchInput]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={space.sm}
            >
              <Icon name="close" color={color.dim} size={14} />
            </Pressable>
          ) : null}
        </View>

        {/* Hidden while searching: results cross all three, so a lit tab would
            be claiming a filter that is not applied. */}
        {searching ? null : (
          <View style={styles.tabs}>
            <RosterTab
              label={`FRIENDS ${overview?.friends.length ?? 0}`}
              active={tab === 'friends'}
              onPress={() => setTab('friends')}
            />
            <RosterTab
              label={`REQUESTS ${overview?.incoming.length ?? 0}`}
              active={tab === 'requests'}
              onPress={() => setTab('requests')}
            />
            <RosterTab
              label={`SENT ${overview?.outgoing.length ?? 0}`}
              active={tab === 'sent'}
              onPress={() => setTab('sent')}
            />
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Text accessibilityRole="alert" style={[type.bodySm, styles.error]}>
            {error}
          </Text>
        ) : null}

        {isPending && !searching ? (
          <Loading />
        ) : isError && !searching ? (
          <EmptyState title="Couldn't load" body="The instance didn't answer — try again." />
        ) : searching && isFetching && rows.length === 0 ? (
          <Loading />
        ) : searching && searchFailed ? (
          // Not silence: with no results *and* a failed request, "no one
          // matches" would state a negative we don't have.
          <EmptyState
            title="Search unavailable"
            body="People search didn’t answer — try again in a moment."
          />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[type.eyebrow, text.faint]}>
              {searching ? 'NO MATCHES' : 'NOTHING HERE YET'}
            </Text>
          </View>
        ) : (
          rows.map(({ person, state, note }) => (
            <PersonRow
              key={person.id}
              person={person}
              state={state}
              note={note}
              disabled={busy}
              onAct={() => act(state, person)}
              onDecline={() => decline(person)}
            />
          ))
        )}
      </ScrollView>

      {unfriending ? (
        <ConfirmSheet
          title="Remove friend?"
          body={`${unfriending.name} goes back to being a stranger, and any list you share with friends only stops being visible to them.`}
          confirmLabel="Remove"
          onConfirm={() =>
            friendActions.remove.mutateAsync(unfriending.id).then(() => commitHaptic())
          }
          onClose={() => setUnfriending(null)}
        />
      ) : null}
    </PageFrame>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingBottom: space.md,
  },
  title: {
    flex: 1,
    fontFamily: type.title.fontFamily,
    fontSize: 24,
    lineHeight: 26,
    color: color.fg,
  },
  invite: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  inviteFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    gap: space.sm,
    paddingHorizontal: layout.gutter,
    paddingBottom: space.md,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.cardSm - 4,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glassWell,
  },
  searchInput: {
    flex: 1,
    color: color.fg,
    paddingVertical: space.md,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.xs + 2,
  },
  list: {
    gap: space.sm,
    paddingHorizontal: layout.gutter,
  },
  // An incoming request is the one row on this screen that wants answering,
  // and the design says so with the card's own edge rather than a badge.
  empty: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    borderRadius: radius.cardSm - 4,
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
  },
  error: {
    color: color.pink,
  },
});
