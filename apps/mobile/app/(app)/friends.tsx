import {
  useAcceptFriendRequest,
  useDebounced,
  useFriends,
  useRemoveFriend,
  useSendFriendRequest,
  useUserSearch,
} from '@trackt/client';
import type { FriendState, UserSummary } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/Avatar';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { Icon } from '../../src/components/Icon';
import { EmptyState, Loading, PageFrame } from '../../src/components/Page';
import { AnimatedPressable, ripple, usePressMotion } from '../../src/components/Press';
import { Touchable } from '../../src/components/Touchable';
import { commitHaptic, errorHaptic } from '../../src/lib/haptics';
import { useInstance } from '../../src/lib/instance-provider';
import { useAuthedScreen } from '../../src/lib/session';
import { PRISM, color, layout, radius, space, surface, text } from '../../src/theme/tokens';
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
  const router = useRouter();
  const { origin } = useInstance();
  const { data: overview, isPending, isError } = useFriends();

  const [tab, setTab] = useState<Tab>('friends');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unfriending, setUnfriending] = useState<UserSummary | null>(null);

  const debounced = useDebounced(query).trim();
  const searching = debounced.length >= 2;
  const { data: results, isFetching, isError: searchFailed } = useUserSearch(debounced);

  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();
  const busy = sendRequest.isPending || accept.isPending || remove.isPending;

  const handlers = {
    onSuccess: () => commitHaptic(),
    onError: (cause: unknown) => {
      errorHaptic();
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
    },
  };

  const act = (state: FriendState, person: UserSummary) => {
    setError(null);
    if (state === 'none') sendRequest.mutate(person.username, handlers);
    else if (state === 'incoming') accept.mutate(person.id, handlers);
    else if (state === 'outgoing') remove.mutate(person.id, handlers);
    else if (state === 'friends') setUnfriending(person);
  };

  const decline = (person: UserSummary) => {
    setError(null);
    remove.mutate(person.id, handlers);
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="chevron-left" color={color.dim} size={20} />
        </Pressable>
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
            <Tab
              label={`FRIENDS ${overview?.friends.length ?? 0}`}
              active={tab === 'friends'}
              onPress={() => setTab('friends')}
            />
            <Tab
              label={`REQUESTS ${overview?.incoming.length ?? 0}`}
              active={tab === 'requests'}
              onPress={() => setTab('requests')}
            />
            <Tab
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
          onConfirm={() => remove.mutateAsync(unfriending.id).then(() => commitHaptic())}
          onClose={() => setUnfriending(null)}
        />
      ) : null}
    </PageFrame>
  );
}

/** What the roster says under a name when it is a search result. */
function friendStateNote(state: FriendState): string {
  if (state === 'friends') return 'FRIENDS';
  if (state === 'incoming') return 'WANTS TO BE FRIENDS';
  if (state === 'outgoing') return 'REQUEST SENT';
  if (state === 'self') return 'THIS IS YOU';
  return '';
}

/** The pill each state wears, and what pressing it does (`fCard` in the mockup). */
const ACTION: Record<FriendState, { label: string; tone: 'prism' | 'friends' | 'quiet' | 'add' }> =
  {
    incoming: { label: 'ACCEPT', tone: 'prism' },
    friends: { label: 'FRIENDS ✓', tone: 'friends' },
    outgoing: { label: 'REQUESTED', tone: 'quiet' },
    none: { label: 'ADD', tone: 'add' },
    self: { label: 'YOU', tone: 'quiet' },
  };

function PersonRow({
  person,
  state,
  note,
  disabled,
  onAct,
  onDecline,
}: {
  person: UserSummary;
  state: FriendState;
  note: string;
  disabled: boolean;
  onAct: () => void;
  onDecline: () => void;
}) {
  const action = ACTION[state];
  const press = usePressMotion();
  const inert = disabled || state === 'self';

  return (
    <Touchable
      href={`/users/${person.username}`}
      style={[styles.row, state === 'incoming' && styles.rowRequest]}
    >
      <Avatar name={person.username} image={person.image} size={40} />
      <View style={styles.rowText}>
        <Text style={[type.cardTitle, text.fg]} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          @{person.username}
          {note ? ` · ${note}` : ''}
        </Text>
      </View>

      {/* A decline needs its own target, and it is the quiet one: the mockup
          gives it a 30pt ring beside the pill rather than a second label. */}
      {state === 'incoming' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decline ${person.name}`}
          disabled={disabled}
          onPress={onDecline}
          hitSlop={space.sm}
          style={({ pressed }) => [styles.decline, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="close" color={color.dim} size={12} />
        </Pressable>
      ) : null}

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${action.label.toLowerCase()} ${person.name}`}
        accessibilityState={{ disabled: inert }}
        disabled={inert}
        onPress={onAct}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        android_ripple={ripple()}
        style={[styles.pill, TONES[action.tone], inert && styles.pillInert, press.animatedStyle]}
      >
        {action.tone === 'prism' ? (
          <LinearGradient
            colors={[...PRISM]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.pillFill}
          >
            <Text style={[styles.pillLabel, text.onPrism]}>{action.label}</Text>
          </LinearGradient>
        ) : (
          <View style={styles.pillFill}>
            <Text style={[styles.pillLabel, TONE_TEXT[action.tone]]}>{action.label}</Text>
          </View>
        )}
      </AnimatedPressable>
    </Touchable>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        !active && styles.tabIdle,
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {active ? (
        <LinearGradient
          colors={[color.pink, color.kindMovie]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.tabFill}
        >
          <Text style={[styles.tabLabel, text.onPrism]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={styles.tabFill}>
          <Text style={[styles.tabLabel, text.dim]}>{label}</Text>
        </View>
      )}
    </Pressable>
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
  back: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -space.sm,
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
    borderWidth: StyleSheet.hairlineWidth,
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
  tab: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  tabIdle: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
  },
  tabFill: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md + 1,
  },
  tabLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  list: {
    gap: space.sm,
    paddingHorizontal: layout.gutter,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md - 1,
    padding: space.md - 1,
    borderRadius: radius.cardSm - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  // An incoming request is the one row on this screen that wants answering,
  // and the design says so with the card's own edge rather than a badge.
  rowRequest: {
    borderColor: 'rgba(217,164,65,0.4)',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.4,
    color: color.dim,
  },
  decline: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
  },
  pill: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  pillInert: {
    opacity: 0.6,
  },
  pillFill: {
    paddingVertical: space.sm + 1,
    paddingHorizontal: space.md,
  },
  pillLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    borderRadius: radius.cardSm - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
  },
  error: {
    color: color.pink,
  },
});

/** The three non-PRISM pill skins, kept beside the styles they belong to. */
const TONES = StyleSheet.create({
  prism: {},
  friends: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.5)',
    backgroundColor: 'rgba(139,92,246,0.16)',
  },
  quiet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  add: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217,107,176,0.5)',
    backgroundColor: 'rgba(217,107,176,0.14)',
  },
});

const TONE_TEXT = StyleSheet.create({
  prism: { color: color.onPrism },
  friends: { color: '#c4b5fd' },
  quiet: { color: color.dim },
  add: { color: color.pink },
});
