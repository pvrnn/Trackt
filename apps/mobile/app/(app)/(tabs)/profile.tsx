import { useQueryClient } from '@tanstack/react-query';
import { useFlag, useLists, useProfileSummary } from '@trackt/client';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../../src/i18n';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LanguageSheet } from '../../../src/components/LanguageSheet';
import { DeleteAccountSheet } from '../../../src/components/DeleteAccountSheet';
import { EditProfileSheet } from '../../../src/components/EditProfileSheet';
import { Icon } from '../../../src/components/Icon';
import {
  Loading,
  PageFrame,
  QueryState,
  SectionTitle,
  pullToRefresh,
  useTabContentInset,
} from '../../../src/components/Page';
import { ripple } from '../../../src/components/Press';
import { Destination } from '../../../src/components/Destination';
import {
  Favourites,
  ProfileIdentity,
  ProfileTimeline,
  RightNow,
  StatStrip,
  Taste,
} from '../../../src/components/ProfileSections';
import { PrismButton } from '../../../src/components/PrismButton';
import { authClient } from '../../../src/lib/auth-client';
import { useInstance } from '../../../src/lib/instance-provider';
import { CLIENT_VERSION } from '../../../src/lib/instance';
import { useAuthedScreen } from '../../../src/lib/session';
import { color, layout, space, stroke, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * Profile (`GET /me/profile`) — and the app's second navigation level.
 *
 * Taste first, navigation last (`Mobile App.dc.html`, PROFILE): who, the year in
 * numbers, favourites, what is open, taste — then the rows into Friends, Lists
 * and History, which live here rather than in a six-tab bar.
 */
export default function ProfileTab() {
  const { user, isPending: sessionPending, refetch: refetchSession } = useAuthedScreen();
  const { t } = useTranslation();
  const listsOn = useFlag('lists.custom');
  const { data: lists } = useLists();
  const { origin, forgetInstance } = useInstance();
  const { data, dataUpdatedAt, isPending, isError, refetch, isRefetching } = useProfileSummary();
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
        <ProfileIdentity
          name={data?.user.name ?? user.name}
          username={data?.user.username ?? user.username}
          image={data?.user.image}
          friendCount={data?.stats.friendCount}
          dayStreak={data?.stats.dayStreak}
          action={
            data ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('profile.edit.title')}
                onPress={() => setEditing(true)}
                android_ripple={ripple(true)}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <Icon name="pencil" color={color.muted} size={18} />
              </Pressable>
            ) : null
          }
        />
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
              <StatStrip
                items={[
                  {
                    value: data.stats.episodesThisYear,
                    label: t('profile.stats.episodesThisYear'),
                  },
                  {
                    value: data.stats.chaptersThisYear,
                    label: t('profile.stats.chaptersThisYear'),
                  },
                  { value: data.stats.completed, label: t('profile.stats.completed') },
                  { value: data.stats.titlesTracked, label: t('profile.stats.titles') },
                ]}
              />

              <Favourites
                favorites={data.favorites}
                emptyMessage={t('profile.favourites.emptyOwn')}
              />

              <RightNow entries={data.inProgress} total={data.inProgressCount} />

              <ProfileTimeline />

              <Taste taste={data.taste} />

              {/* The second navigation level the four-tab spine displaces here. */}
              <View style={styles.destinations}>
                <Destination
                  icon="person"
                  href="/friends"
                  label={t('social.title')}
                  meta={
                    data.stats.incomingRequestCount > 0
                      ? t('profile.friendsMeta', {
                          count: data.stats.friendCount,
                          requests: data.stats.incomingRequestCount,
                        })
                      : String(data.stats.friendCount)
                  }
                />
                {listsOn ? (
                  <Destination
                    icon="list"
                    href="/lists"
                    label={t('lists.title')}
                    meta={lists ? String(lists.length) : undefined}
                  />
                ) : null}
                <Destination
                  icon="clock"
                  href="/history"
                  label={t('history.title')}
                  meta={t('profile.completedCount', { count: data.stats.completed })}
                />
              </View>
            </>
          )}
        </QueryState>

        <View style={styles.account}>
          <SectionTitle title={t('profile.account')} />
          <Text style={[type.bodySm, text.dim]}>
            {origin} · app {CLIENT_VERSION}
          </Text>
          <PrismButton
            label={`${t('locale.switch')} · ${i18n.language.toUpperCase()}`}
            variant="secondary"
            onPress={() => setLanguageOpen(true)}
          />
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

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
    gap: layout.sectionGap,
  },
  bio: {
    color: color.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: -space.md - 2,
  },
  editButton: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: layout.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
  destinations: {
    gap: space.sm - 2,
  },
  account: {
    gap: space.md,
  },
});
