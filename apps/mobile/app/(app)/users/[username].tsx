import {
  KIND_LABELS,
  activityVerbLabel,
  relativeTime,
  useAcceptFriendRequest,
  usePublicProfile,
  useRemoveFriend,
  useSendFriendRequest,
} from '@trackt/client';
import {
  MEDIA_KINDS,
  type FavoriteEntry,
  type FriendState,
  type PublicProfile,
} from '@trackt/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../src/components/Avatar';
import { ConfirmSheet } from '../../../src/components/ConfirmSheet';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import {
  BackLink,
  EmptyState,
  Loading,
  PageScroll,
  SectionTitle,
} from '../../../src/components/Page';
import { PrismButton } from '../../../src/components/PrismButton';
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
import { commitHaptic, errorHaptic } from '../../../src/lib/haptics';
import { useOptionalSession } from '../../../src/lib/session';
import { useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/** What the viewer's relationship to this account currently is, in words. */
const FRIEND_STATE_LABELS: Record<FriendState, string> = {
  none: '',
  friends: 'FRIENDS',
  outgoing: 'REQUEST SENT',
  incoming: 'WANTS TO BE FRIENDS',
  self: 'THIS IS YOU',
};

/**
 * Someone else's profile (`GET /users/:username/profile`, ADR-0006).
 *
 * Anonymous-readable by contract: nothing here is gated on friendship, and
 * `friendState` is context the viewer sees beside it rather than a key to it —
 * it decides only what the action button under the handle does.
 */
export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { data: profile, isPending, isError } = usePublicProfile(username);
  const { user: viewer } = useOptionalSession();

  if (isPending) {
    return (
      <PageScroll>
        <BackLink />
        <Loading />
      </PageScroll>
    );
  }

  if (isError || !profile) {
    return (
      <PageScroll>
        <BackLink />
        <EmptyState
          title="No such profile"
          body={`Nobody on this instance goes by @${username}.`}
        />
      </PageScroll>
    );
  }

  const relationship = FRIEND_STATE_LABELS[profile.friendState];

  return (
    <PageScroll>
      <View style={styles.head}>
        <BackLink />
        <View style={styles.header}>
          <Avatar name={profile.user.name} image={profile.user.image} size={88} />
          <View style={styles.headerText}>
            <Text style={[type.title, styles.fg]} numberOfLines={2}>
              {profile.user.name.toUpperCase()}
            </Text>
            <Text style={[type.eyebrow, styles.dim]}>@{profile.user.username}</Text>
            {relationship ? (
              <Text style={[type.eyebrow, styles.relationship]}>{relationship}</Text>
            ) : null}
            <FriendAction profile={profile} signedIn={viewer !== null} />
          </View>
        </View>
        {profile.user.bio ? (
          <Text style={[type.body, styles.muted]}>{profile.user.bio}</Text>
        ) : null}
      </View>

      <View style={styles.stats}>
        <Stat value={profile.stats.titlesTracked} label="Tracked" />
        <Stat value={profile.stats.completed} label="Completed" />
        <Stat value={profile.stats.dayStreak} label="Day streak" />
        <Stat value={profile.friendCount} label="Friends" />
      </View>

      {MEDIA_KINDS.map((kind) => {
        const favorites = profile.favorites.filter((entry) => entry.kind === kind);
        if (favorites.length === 0) return null;
        return <FavoriteBlock key={kind} label={KIND_LABELS[kind]} entries={favorites} />;
      })}

      {profile.activity.length > 0 ? (
        <View>
          <SectionTitle title="Recent activity" />
          <GlassCard style={styles.activityCard}>
            {profile.activity.map((entry, index) => (
              <Touchable
                key={`${entry.slug}-${entry.at}-${index}`}
                href={`/media/${entry.slug}`}
                style={[styles.activityRow, index > 0 && styles.divider]}
              >
                <KindDot kind={entry.kind} />
                <Text style={[type.bodySm, styles.activityText]} numberOfLines={2}>
                  {activityVerbLabel(entry).toLowerCase()} {entry.title}{' '}
                  <Text style={styles.dim}>{entry.detail}</Text>
                </Text>
                <Text style={[type.eyebrow, styles.dim]}>{relativeTime(entry.at)}</Text>
              </Touchable>
            ))}
          </GlassCard>
        </View>
      ) : null}
    </PageScroll>
  );
}

/**
 * The one control on this screen (ADR-0006): send, withdraw, accept, decline,
 * or unfriend — whichever the viewer's `friendState` leaves available.
 *
 * Unfriending asks first, and it is the only friend action that does: it is the
 * one with no cheap reversal (the other side has to accept again). A signed-out
 * visitor gets a route to login rather than a disabled button, since the page
 * itself is public and arriving here from a shared link is normal.
 */
function FriendAction({ profile, signedIn }: { profile: PublicProfile; signedIn: boolean }) {
  const router = useRouter();
  const writeFailed = useWriteFailedToast();
  const sendRequest = useSendFriendRequest();
  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriend();
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false);

  const busy = sendRequest.isPending || accept.isPending || remove.isPending;
  const handlers = {
    onSuccess: () => commitHaptic(),
    onError: (cause: unknown) => {
      errorHaptic();
      writeFailed(cause);
    },
  };

  if (profile.friendState === 'self') {
    return (
      <PrismButton
        label="Edit on your profile"
        variant="secondary"
        onPress={() => router.push('/profile')}
        style={styles.action}
      />
    );
  }

  if (!signedIn) {
    return (
      <PrismButton
        label="Sign in to add"
        variant="secondary"
        onPress={() => router.push('/login')}
        style={styles.action}
      />
    );
  }

  return (
    <View style={styles.actions}>
      {profile.friendState === 'none' ? (
        <PrismButton
          label="Add friend"
          icon="plus"
          busy={sendRequest.isPending}
          disabled={busy}
          onPress={() => sendRequest.mutate(profile.user.username, handlers)}
          style={styles.action}
        />
      ) : null}
      {profile.friendState === 'outgoing' ? (
        <PrismButton
          label="Request sent"
          icon="close"
          variant="secondary"
          busy={remove.isPending}
          disabled={busy}
          onPress={() => remove.mutate(profile.userId, handlers)}
          style={styles.action}
        />
      ) : null}
      {profile.friendState === 'incoming' ? (
        <>
          <PrismButton
            label="Accept"
            busy={accept.isPending}
            disabled={busy}
            onPress={() => accept.mutate(profile.userId, handlers)}
            style={styles.action}
          />
          <PrismButton
            label="Decline"
            variant="secondary"
            disabled={busy}
            onPress={() => remove.mutate(profile.userId, handlers)}
            style={styles.action}
          />
        </>
      ) : null}
      {profile.friendState === 'friends' ? (
        <PrismButton
          label="Friends"
          icon="check"
          variant="secondary"
          disabled={busy}
          onPress={() => setConfirmingUnfriend(true)}
          style={styles.action}
        />
      ) : null}

      {confirmingUnfriend ? (
        <ConfirmSheet
          title="Remove friend?"
          body={`${profile.user.name} goes back to being a stranger, and any list you share with friends only stops being visible to them.`}
          confirmLabel="Remove"
          onConfirm={() => remove.mutateAsync(profile.userId).then(() => commitHaptic())}
          onClose={() => setConfirmingUnfriend(false)}
        />
      ) : null}
    </View>
  );
}

function FavoriteBlock({ label, entries }: { label: string; entries: FavoriteEntry[] }) {
  return (
    <View>
      <SectionTitle title={label} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelf}
      >
        {entries.map((entry) => (
          <Touchable key={entry.id} href={`/media/${entry.slug}`}>
            <Cover kind={entry.kind} title={entry.title} coverUrl={entry.coverUrl} width={96} />
            <Text style={[type.bodySm, styles.shelfCaption]} numberOfLines={1}>
              {entry.title}
            </Text>
          </Touchable>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <GlassCard style={styles.stat}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{String(value)}</PrismText>
      </View>
      <Text style={[type.eyebrow, styles.dim]}>{label.toUpperCase()}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  headerText: {
    flex: 1,
    gap: space.xs,
  },
  relationship: {
    color: color.pink,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: space.lg,
    gap: space.xs,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
  shelf: {
    gap: space.md,
  },
  shelfCaption: {
    color: color.fg,
    width: 96,
    marginTop: space.sm,
  },
  activityCard: {
    paddingHorizontal: space.lg,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: layout.touchTarget,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surface.divider,
  },
  activityText: {
    flex: 1,
    color: color.fg,
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
});
