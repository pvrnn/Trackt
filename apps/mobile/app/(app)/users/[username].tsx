import { KIND_LABELS, activityVerbLabel, relativeTime, usePublicProfile } from '@trackt/client';
import { MEDIA_KINDS, type FavoriteEntry, type FriendState } from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../src/components/Avatar';
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
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
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
 * `friendState` is context the viewer sees beside it rather than a key to it.
 * It reads as a label for now — sending, accepting and removing are mutations,
 * so they land with the rest of phase 3.
 */
export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { data: profile, isPending, isError } = usePublicProfile(username);

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
