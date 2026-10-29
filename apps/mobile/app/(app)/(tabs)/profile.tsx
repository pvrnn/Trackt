import { useQueryClient } from '@tanstack/react-query';
import { relativeTime, useFlag, useFriends, useProfileSummary } from '@trackt/client';
import { useLabels } from '../../../src/lib/labels';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../../src/i18n';
import { MEDIA_KINDS, type FavoriteEntry } from '@trackt/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../src/components/Avatar';
import { LanguageSheet } from '../../../src/components/LanguageSheet';
import { DeleteAccountSheet } from '../../../src/components/DeleteAccountSheet';
import { EditProfileSheet } from '../../../src/components/EditProfileSheet';
import { GlassCard } from '../../../src/components/GlassCard';
import { Icon } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import {
  Loading,
  PageFrame,
  QueryState,
  SectionTitle,
  pullToRefresh,
  useTabContentInset,
} from '../../../src/components/Page';
import { Destination } from '../../../src/components/Destination';
import { Shelf, ShelfItem } from '../../../src/components/Shelf';
import { Stat, Stats } from '../../../src/components/Stat';
import { Touchable } from '../../../src/components/Touchable';
import { PrismButton } from '../../../src/components/PrismButton';
import { authClient } from '../../../src/lib/auth-client';
import { useInstance } from '../../../src/lib/instance-provider';
import { CLIENT_VERSION } from '../../../src/lib/instance';
import { useAuthedScreen } from '../../../src/lib/session';
import { color, layout, radius, space, stroke, surface, text } from '../../../src/theme/tokens';
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
  const { t } = useTranslation();
  const labels = useLabels();
  const listsOn = useFlag('lists.custom');
  const { origin, forgetInstance } = useInstance();
  const { data, dataUpdatedAt, isPending, isError, refetch, isRefetching } = useProfileSummary();
  const { data: friends } = useFriends();
  const queryClient = useQueryClient();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

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
        refreshControl={pullToRefresh(isRefetching, () => void refetch())}
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
              {data ? ` · ${t('social.friendLabel', { count: data.stats.friendCount })}` : ''}
            </Text>
            {data && data.stats.dayStreak > 0 ? (
              <View style={styles.streak}>
                <View style={styles.streakDot} />
                <Text style={[type.eyebrow, text.pink]}>
                  {t('profile.header.streak', { count: data.stats.dayStreak })}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('locale.switch')}
            onPress={() => setLanguageOpen(true)}
            style={({ pressed }) => [styles.langButton, pressed && styles.langButtonPressed]}
          >
            <Text style={styles.langButtonText}>{i18n.language.toUpperCase()}</Text>
          </Pressable>
        </View>
        {data?.user.bio ? <Text style={[type.body, styles.bio]}>{data.user.bio}</Text> : null}

        <QueryState
          query={{ data, isPending, isError, dataUpdatedAt }}
          error={{
            title: t('media.loadFailed.title'),
            body: t('home.loadError'),
          }}
        >
          {(data) => (
            <>
              <Stats>
                <Stat value={data.stats.titlesTracked} label={t('profile.stats.titles')} compact />
                <Stat value={data.stats.completed} label={t('profile.stats.completed')} compact />
                <Stat
                  value={data.stats.episodesThisYear}
                  label={t('profile.stats.episodesThisYear')}
                  compact
                />
                <Stat
                  value={data.stats.chaptersThisYear}
                  label={t('profile.stats.chaptersThisYear')}
                  compact
                />
              </Stats>

              {/* The second navigation level the four-tab spine displaces here —
                one row each, glyph to chevron, the way the design files it. */}
              <View style={styles.destinations}>
                {listsOn ? (
                  <Destination
                    icon="list"
                    href="/lists"
                    label={t('lists.title')}
                    meta={t('profile.yourCollections')}
                  />
                ) : null}
                <Destination
                  icon="clock"
                  href="/history"
                  label={t('history.title')}
                  meta={`${data.stats.completed} DONE`}
                />
                <Destination
                  icon="settings"
                  label={t('profile.edit.title')}
                  onPress={() => setEditing(true)}
                />
              </View>

              {/* Friends gets a shelf of its own, the shape Favourites has:
                faces are what you actually recognise, and the section title
                carries the way in to the roster — plus the request badge, which
                is the one thing on this screen that wants answering. */}
              <View style={styles.favourites}>
                <SectionTitle
                  title={t('social.title')}
                  action={
                    <Touchable
                      href="/friends"
                      accessibilityLabel={
                        data.stats.incomingRequestCount > 0
                          ? t('profile.allFriendsPending', {
                              count: data.stats.incomingRequestCount,
                            })
                          : t('profile.allFriends')
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
                  <Shelf>
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
                  </Shelf>
                ) : (
                  <Text style={[type.bodySm, text.dim]}>
                    No friends yet — search by name or handle to send a request.
                  </Text>
                )}
              </View>

              {data.favorites.length > 0 ? (
                <View style={styles.favourites}>
                  <SectionTitle title={t('profile.favourites.title')} />
                  {/* One heading, then a shelf per kind — because the rank is per
                    kind (`favorite.position`), and a single mixed shelf would
                    put two number ones next to each other. */}
                  {MEDIA_KINDS.map((kind) => {
                    const favorites = data.favorites.filter((entry) => entry.kind === kind);
                    if (favorites.length === 0) return null;
                    return (
                      <FavoriteBlock key={kind} label={labels.kind(kind)} entries={favorites} />
                    );
                  })}
                </View>
              ) : null}

              {data.activity.length > 0 ? (
                <View>
                  <SectionTitle title={t('home.activity.title')} />
                  <GlassCard style={styles.activityCard}>
                    {data.activity.map((entry, index) => (
                      <Touchable
                        key={`${entry.slug}-${entry.at}-${index}`}
                        href={`/media/${entry.slug}`}
                        style={[styles.activityRow, index > 0 && styles.divider]}
                      >
                        <KindDot kind={entry.kind} />
                        <Text style={[type.bodySm, styles.activityText]} numberOfLines={2}>
                          {labels.activity(entry).toLowerCase()} {entry.title}{' '}
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
        </QueryState>

        <View style={styles.account}>
          <SectionTitle title={t('profile.account')} />
          <Text style={[type.bodySm, text.dim]}>
            {origin} · app {CLIENT_VERSION}
          </Text>
          {/* Language switcher moved to the header (top right). */}
          <PrismButton
            label={t('shell.signOut')}
            variant="secondary"
            onPress={() => void authClient().signOut()}
          />
          <PrismButton
            label={t('profile.changeServer')}
            variant="secondary"
            onPress={() => void forgetInstance()}
          />
          {/* Last, and quiet: required for App Store submission and the missing
              half of the portability principle, but nothing anyone is looking
              for on this screen. The sheet behind it does the asking. */}
          <PrismButton
            label={t('profile.deleteAccount')}
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

      {languageOpen ? <LanguageSheet onClose={() => setLanguageOpen(false)} /> : null}
    </PageFrame>
  );
}

function FavoriteBlock({ label, entries }: { label: string; entries: FavoriteEntry[] }) {
  return (
    <View style={styles.favouriteBlock}>
      <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
      <Shelf>
        {entries.map((entry) => (
          <ShelfItem
            key={entry.id}
            href={`/media/${entry.slug}`}
            kind={entry.kind}
            title={entry.title}
            coverUrl={entry.coverUrl}
            width={88}
            caption={false}
            coverTitle={false}
            accessibilityLabel={`${entry.title}, number ${entry.rank}`}
            // The rank rides *on* the cover: under it, it needed a caption to
            // explain itself, and the shelf grew a second line of text for a
            // number that is already an ordering.
            overlay={
              <View style={styles.rankBadge}>
                <Text style={styles.rank}>{String(entry.rank).padStart(2, '0')}</Text>
              </View>
            }
          />
        ))}
      </Shelf>
    </View>
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
  destinationText: {
    gap: space.xs,
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
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  activityText: {
    flex: 1,
    color: color.fg,
  },
  account: {
    gap: space.md,
  },
  langButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
    marginLeft: 'auto',
  },
  langButtonPressed: {
    opacity: 0.7,
  },
  langButtonText: {
    fontFamily: type.button.fontFamily,
    fontSize: 12,
    color: color.fg,
    letterSpacing: 0.6,
  },
});
