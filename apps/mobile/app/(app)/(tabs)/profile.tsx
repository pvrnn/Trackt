import { useQueryClient } from '@tanstack/react-query';
import {
  KIND_LABELS,
  activityVerbLabel,
  relativeTime,
  useFriends,
  useProfileSummary,
} from '@trackt/client';
import { MEDIA_KINDS, type FavoriteEntry } from '@trackt/shared';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../src/components/Avatar';
import { Cover } from '../../../src/components/Cover';
import { EditProfileSheet } from '../../../src/components/EditProfileSheet';
import { FriendsSheet } from '../../../src/components/FriendsSheet';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  PageFrame,
  SectionTitle,
  useTabContentInset,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { PrismButton } from '../../../src/components/PrismButton';
import { PrismText } from '../../../src/components/PrismText';
import { authClient } from '../../../src/lib/auth-client';
import { useInstance } from '../../../src/lib/instance-provider';
import { CLIENT_VERSION } from '../../../src/lib/instance';
import { useAuthedScreen } from '../../../src/lib/session';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * Profile (`GET /me/profile`) — and the app's second navigation level.
 *
 * `Mobile System.dc.html` §03 puts **Lists and History inside Profile**, as two
 * rows directly under the stat band, rather than in the tab bar: both are weekly
 * destinations, not daily ones, and a six-tab bar squeezes its labels under
 * 10px. That is the one structural difference from `AppNav` on web, which
 * already treats History as a secondary destination anyway.
 *
 * Phase 3 gives it its two writes: the profile edit (name, bio, photo) and the
 * friends sheet, which is also the app's only accept/decline inbox.
 */
export default function ProfileTab() {
  const { user, isPending: sessionPending, refetch: refetchSession } = useAuthedScreen();
  const { origin, forgetInstance } = useInstance();
  const { data, isPending, isError, refetch, isRefetching } = useProfileSummary();
  const { data: friends } = useFriends();
  const queryClient = useQueryClient();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [managingFriends, setManagingFriends] = useState(false);

  if (sessionPending || !user) {
    return (
      <PageFrame>
        <Loading />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.lg, paddingBottom: bottomInset },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.pink}
            colors={[color.pink]}
          />
        }
      >
        <View style={styles.header}>
          <Avatar name={data?.user.name ?? user.name} image={data?.user.image} size={88} />
          <View style={styles.headerText}>
            <Text style={[type.title, styles.fg]} numberOfLines={2}>
              {(data?.user.name ?? user.name).toUpperCase()}
            </Text>
            <Text style={[type.eyebrow, styles.dim]}>@{data?.user.username ?? user.username}</Text>
            {data ? (
              <PrismButton
                label="Edit profile"
                variant="secondary"
                onPress={() => setEditing(true)}
                style={styles.shrink}
              />
            ) : null}
          </View>
        </View>
        {data?.user.bio ? <Text style={[type.body, styles.bio]}>{data.user.bio}</Text> : null}

        {isPending ? (
          <Loading />
        ) : isError || !data ? (
          <EmptyState
            title="Couldn't load"
            body="The instance didn't answer. Pull down to try again."
          />
        ) : (
          <>
            <View style={styles.stats}>
              <Stat value={data.stats.titlesTracked} label="Tracked" />
              <Stat value={data.stats.completed} label="Completed" />
              <Stat value={data.stats.dayStreak} label="Day streak" />
              <Stat value={data.stats.friendCount} label="Friends" />
            </View>

            {/* The second navigation level the four-tab spine displaces here. */}
            <View style={styles.destinations}>
              <Destination
                href="/history"
                title="History"
                detail={`${data.stats.completed} completed`}
              />
              <Destination href="/lists" title="Lists" detail="Your collections" />
            </View>

            <View>
              <SectionTitle
                title="Friends"
                action={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      data.stats.incomingRequestCount > 0
                        ? `Friends — ${data.stats.incomingRequestCount} pending requests`
                        : 'Add a friend'
                    }
                    onPress={() => setManagingFriends(true)}
                    style={({ pressed }) => [styles.addFriend, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[type.button, styles.pink]}>＋ ADD FRIEND</Text>
                    {/* The badge is why this control is here and not only in
                        the sheet: an incoming request has no other surface. */}
                    {data.stats.incomingRequestCount > 0 ? (
                      <Text style={[type.eyebrow, styles.badge]}>
                        {data.stats.incomingRequestCount}
                      </Text>
                    ) : null}
                  </Pressable>
                }
              />
              {friends && friends.friends.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.shelf}
                >
                  {friends.friends.map((friend) => (
                    <Touchable
                      key={friend.id}
                      href={`/users/${friend.username}`}
                      style={styles.friend}
                    >
                      <Avatar name={friend.username} image={friend.image} size={56} />
                      <Text style={[type.eyebrow, styles.dim]} numberOfLines={1}>
                        {friend.username}
                      </Text>
                    </Touchable>
                  ))}
                </ScrollView>
              ) : (
                <Text style={[type.bodySm, styles.dim]}>
                  No friends yet — search by name or handle to send a request.
                </Text>
              )}
            </View>

            {MEDIA_KINDS.map((kind) => {
              const favorites = data.favorites.filter((entry) => entry.kind === kind);
              if (favorites.length === 0) return null;
              return <FavoriteBlock key={kind} label={KIND_LABELS[kind]} entries={favorites} />;
            })}

            {data.activity.length > 0 ? (
              <View>
                <SectionTitle title="Recent activity" />
                <GlassCard style={styles.activityCard}>
                  {data.activity.map((entry, index) => (
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
          </>
        )}

        <View style={styles.account}>
          <SectionTitle title="Account" />
          <Text style={[type.bodySm, styles.dim]}>
            {origin} · app {CLIENT_VERSION}
          </Text>
          <PrismButton
            label="Sign out"
            variant="secondary"
            onPress={() => void authClient().signOut()}
          />
          <PrismButton
            label="Change server"
            variant="secondary"
            onPress={() => void forgetInstance()}
          />
        </View>
      </ScrollView>

      {editing && data ? (
        <EditProfileSheet
          user={data.user}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['profile'] });
            // The session carries the name and avatar this screen's header and
            // every other screen's chrome read, and it is not a query.
            refetchSession();
          }}
        />
      ) : null}

      {managingFriends ? <FriendsSheet onClose={() => setManagingFriends(false)} /> : null}
    </PageFrame>
  );
}

function Destination({
  href,
  title,
  detail,
}: {
  href: '/history' | '/lists';
  title: string;
  detail: string;
}) {
  return (
    <Touchable href={href} style={styles.destination}>
      <View style={styles.destinationText}>
        <Text style={[type.section, styles.fg]}>{title.toUpperCase()}</Text>
        <Text style={[type.eyebrow, styles.dim]}>{detail.toUpperCase()}</Text>
      </View>
      <Text style={[type.section, styles.chevron]}>›</Text>
    </Touchable>
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
            <View style={styles.rankRow}>
              <Text style={[type.eyebrow, styles.rank]}>{String(entry.rank).padStart(2, '0')}</Text>
              <Text style={[type.bodySm, styles.shelfCaption]} numberOfLines={1}>
                {entry.title}
              </Text>
            </View>
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
  content: {
    paddingHorizontal: layout.gutter,
    gap: layout.sectionGap,
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
  bio: {
    color: color.muted,
    marginTop: -space.md,
  },
  fg: {
    color: color.fg,
  },
  dim: {
    color: color.dim,
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
  addFriend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget,
  },
  badge: {
    color: color.onPrism,
    backgroundColor: color.pink,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  friend: {
    width: 64,
    alignItems: 'center',
    gap: space.sm,
  },
  pink: {
    color: color.pink,
  },
  destinations: {
    gap: space.sm,
  },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  destinationText: {
    gap: space.xs,
  },
  chevron: {
    color: color.faint,
  },
  shelf: {
    gap: space.md,
  },
  shelfCaption: {
    color: color.fg,
    flex: 1,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    width: 96,
    marginTop: space.sm,
  },
  rank: {
    color: color.pink,
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
  account: {
    gap: space.md,
  },
});
