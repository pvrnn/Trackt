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
import { DeleteAccountSheet } from '../../../src/components/DeleteAccountSheet';
import { EditProfileSheet } from '../../../src/components/EditProfileSheet';
import { GlassCard } from '../../../src/components/GlassCard';
import { Icon, type IconName } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  SectionTitle,
  StaleNotice,
  useTabContentInset,
} from '../../../src/components/Page';
import { ripple } from '../../../src/components/Press';
import { Touchable } from '../../../src/components/Touchable';
import { PrismButton } from '../../../src/components/PrismButton';
import { PrismText } from '../../../src/components/PrismText';
import { authClient } from '../../../src/lib/auth-client';
import { useInstance } from '../../../src/lib/instance-provider';
import { CLIENT_VERSION } from '../../../src/lib/instance';
import { useAuthedScreen } from '../../../src/lib/session';
import { color, layout, radius, space, surface, text } from '../../../src/theme/tokens';
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
 * friends screen, which is also the app's only accept/decline inbox.
 */
export default function ProfileTab() {
  const { user, isPending: sessionPending, refetch: refetchSession } = useAuthedScreen();
  const { origin, forgetInstance } = useInstance();
  const { data, dataUpdatedAt, isPending, isError, refetch, isRefetching } = useProfileSummary();
  const { data: friends } = useFriends();
  const queryClient = useQueryClient();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (sessionPending || !user) {
    return (
      <PageFrame fadeOnFocus>
        <Loading />
      </PageFrame>
    );
  }

  return (
    <PageFrame fadeOnFocus>
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
          <Avatar name={data?.user.name ?? user.name} image={data?.user.image} size={68} />
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={2}>
              {(data?.user.name ?? user.name).toUpperCase()}
            </Text>
            {/* Handle and reach on one line, the streak on its own in pink —
                the design's identity block. A streak is the one number here
                that decays if you stop, which is why it gets the colour. */}
            <Text style={[type.eyebrow, text.dim]}>
              @{data?.user.username ?? user.username}
              {data
                ? ` · ${data.stats.friendCount} ${data.stats.friendCount === 1 ? 'FRIEND' : 'FRIENDS'}`
                : ''}
            </Text>
            {data && data.stats.dayStreak > 0 ? (
              <View style={styles.streak}>
                <View style={styles.streakDot} />
                <Text style={[type.eyebrow, text.pink]}>{data.stats.dayStreak}-DAY STREAK</Text>
              </View>
            ) : null}
          </View>
        </View>
        {data?.user.bio ? <Text style={[type.body, styles.bio]}>{data.user.bio}</Text> : null}

        {isPending ? (
          <OfflineFallback>
            <Loading />
          </OfflineFallback>
        ) : isError || !data ? (
          <EmptyState
            title="Couldn't load"
            body="The instance didn't answer. Pull down to try again."
          />
        ) : (
          <>
            <StaleNotice updatedAt={dataUpdatedAt} />
            <View style={styles.stats}>
              <Stat value={data.stats.titlesTracked} label="Tracked" />
              <Stat value={data.stats.completed} label="Completed" />
              <Stat value={data.stats.episodesThisYear} label="Episodes" />
              <Stat value={data.stats.chaptersThisYear} label="Chapters" />
            </View>

            {/* The second navigation level the four-tab spine displaces here —
                one row each, glyph to chevron, the way the design files it. */}
            <View style={styles.destinations}>
              <Destination icon="list" href="/lists" label="Lists" meta="YOUR COLLECTIONS" />
              <Destination
                icon="clock"
                href="/history"
                label="History"
                meta={`${data.stats.completed} DONE`}
              />
              <Destination icon="settings" label="Edit profile" onPress={() => setEditing(true)} />
            </View>

            {/* Friends gets a shelf of its own, the shape Favourites has:
                faces are what you actually recognise, and the section title
                carries the way in to the roster — plus the request badge, which
                is the one thing on this screen that wants answering. */}
            <View style={styles.favourites}>
              <SectionTitle
                title="Friends"
                action={
                  <Touchable
                    href="/friends"
                    accessibilityLabel={
                      data.stats.incomingRequestCount > 0
                        ? `All friends — ${data.stats.incomingRequestCount} pending requests`
                        : 'All friends'
                    }
                    style={styles.addFriend}
                  >
                    {data.stats.incomingRequestCount > 0 ? (
                      <Text style={[type.eyebrow, styles.badge]}>
                        {data.stats.incomingRequestCount}
                      </Text>
                    ) : null}
                    <Text style={[type.button, text.pink]}>ALL</Text>
                    <Icon name="chevron-right" color={color.pink} size={16} />
                  </Touchable>
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
                      <Text style={[type.eyebrow, text.dim]} numberOfLines={1}>
                        {friend.username}
                      </Text>
                    </Touchable>
                  ))}
                </ScrollView>
              ) : (
                <Text style={[type.bodySm, text.dim]}>
                  No friends yet — search by name or handle to send a request.
                </Text>
              )}
            </View>

            {data.favorites.length > 0 ? (
              <View style={styles.favourites}>
                <SectionTitle title="Favourites" />
                {/* One heading, then a shelf per kind — because the rank is per
                    kind (`favorite.position`), and a single mixed shelf would
                    put two number ones next to each other. */}
                {MEDIA_KINDS.map((kind) => {
                  const favorites = data.favorites.filter((entry) => entry.kind === kind);
                  if (favorites.length === 0) return null;
                  return <FavoriteBlock key={kind} label={KIND_LABELS[kind]} entries={favorites} />;
                })}
              </View>
            ) : null}

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
                        <Text style={text.dim}>{entry.detail}</Text>
                      </Text>
                      <Text style={[type.eyebrow, text.dim]}>{relativeTime(entry.at)}</Text>
                    </Touchable>
                  ))}
                </GlassCard>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.account}>
          <SectionTitle title="Account" />
          <Text style={[type.bodySm, text.dim]}>
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
          {/* Last, and quiet: required for App Store submission and the missing
              half of the portability principle, but nothing anyone is looking
              for on this screen. The sheet behind it does the asking. */}
          <PrismButton
            label="Delete account"
            variant="secondary"
            onPress={() => setDeleting(true)}
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

      {deleting ? (
        <DeleteAccountSheet
          username={data?.user.username ?? user.username}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            // The account is gone and the server has revoked its sessions, but
            // this client still holds one in SecureStore and a query cache full
            // of a profile that no longer exists. Sign out locally to drop
            // both; `useAuthedScreen` sends the now-sessionless app to login.
            void authClient().signOut();
          }}
        />
      ) : null}
    </PageFrame>
  );
}

/**
 * One navigation row: a pink glyph, the destination, what is behind it, and a
 * chevron (`Mobile App.dc.html`, profile). Not the two-line card it used to be —
 * at 14/600 with the count on the right, four of these fit where two did, which
 * is the point of moving lists and history *into* the profile in the first
 * place.
 */
function Destination({
  icon,
  href,
  label,
  meta,
  onPress,
}: {
  icon: IconName;
  href?: '/history' | '/lists' | '/friends';
  label: string;
  meta?: string | undefined;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Icon name={icon} color={color.pink} size={17} />
      <Text style={[type.cardTitle, styles.rowLabel]}>{label}</Text>
      {meta ? <Text style={[type.eyebrow, text.dim]}>{meta.toUpperCase()}</Text> : null}
      <Icon name="chevron-right" color={color.faint} size={16} />
    </>
  );

  if (href) {
    return (
      <Touchable href={href} style={styles.destination}>
        {body}
      </Touchable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={ripple()}
      style={({ pressed }) => [styles.destination, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

function FavoriteBlock({ label, entries }: { label: string; entries: FavoriteEntry[] }) {
  return (
    <View style={styles.favouriteBlock}>
      <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelf}
      >
        {entries.map((entry) => (
          <Touchable
            key={entry.id}
            href={`/media/${entry.slug}`}
            accessibilityLabel={`${entry.title}, number ${entry.rank}`}
          >
            <Cover
              kind={entry.kind}
              title={entry.title}
              coverUrl={entry.coverUrl}
              width={88}
              showTitle={false}
            />
            {/* The rank rides *on* the cover. Under it, it needed a caption to
                explain itself and the shelf grew a second line of text for a
                number that is already an ordering. */}
            <View style={styles.rankBadge}>
              <Text style={styles.rank}>{String(entry.rank).padStart(2, '0')}</Text>
            </View>
          </Touchable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Value and label on one baseline: the design's small card, not a tile. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <GlassCard style={styles.stat}>
      <View style={styles.shrink}>
        <PrismText style={styles.statValue}>{String(value)}</PrismText>
      </View>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
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
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  name: {
    fontFamily: type.title.fontFamily,
    fontSize: 26,
    lineHeight: 27,
    color: color.fg,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  streakDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: color.pink,
  },
  statValue: {
    fontFamily: type.stat.fontFamily,
    fontSize: 20,
    lineHeight: 21,
  },
  statLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 9,
    letterSpacing: 0.72,
    color: color.dim,
  },
  rowLabel: {
    flex: 1,
    color: color.fg,
  },
  favourites: {
    gap: space.md,
  },
  favouriteBlock: {
    gap: space.sm,
  },
  rankBadge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14,12,16,0.85)',
  },
  // 2×2 of compact cards: value and label share a baseline, so the block is a
  // reading of the year rather than four tiles competing with the name above.
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingVertical: space.md - 2,
    paddingHorizontal: space.md,
    borderRadius: radius.cardSm - 4,
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
  destinations: {
    gap: space.sm,
  },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + 6,
    paddingHorizontal: space.lg,
    borderRadius: radius.cardSm - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  destinationText: {
    gap: space.xs,
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
    fontFamily: type.title.fontFamily,
    fontSize: 11,
    lineHeight: 14,
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
