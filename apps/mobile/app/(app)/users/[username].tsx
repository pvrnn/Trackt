import { relativeTime, usePublicProfile } from '@trackt/client';
import { useLabels } from '../../../src/lib/labels';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type FavoriteEntry, type PublicProfile } from '@trackt/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../src/components/Avatar';
import { ConfirmSheet } from '../../../src/components/ConfirmSheet';
import { Shelf, ShelfItem } from '../../../src/components/Shelf';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import { PageScroll, ScreenState, SectionTitle } from '../../../src/components/Page';
import { Stat, Stats } from '../../../src/components/Stat';
import { PrismButton } from '../../../src/components/PrismButton';
import { Touchable } from '../../../src/components/Touchable';
import { commitHaptic } from '../../../src/lib/haptics';
import { useFriendActions } from '../../../src/lib/friends';
import { useOptionalSession } from '../../../src/lib/session';
import { useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, space, stroke, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * Someone else's profile (`GET /users/:username/profile`, ADR-0006).
 *
 * Anonymous-readable by contract: nothing here is gated on friendship, and
 * `friendState` is context the viewer sees beside it rather than a key to it —
 * it decides only what the action button under the handle does.
 */
export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: profile, isPending, isError } = usePublicProfile(username);
  const { user: viewer } = useOptionalSession();

  if (isPending || isError || !profile) {
    return (
      <ScreenState
        isPending={isPending}
        title={t('profile.public.notFoundTitle')}
        body={t('profile.public.notFoundBody', { username })}
      />
    );
  }

  const relationshipKey =
    profile.friendState === 'friends'
      ? 'social.stateNote.friends'
      : profile.friendState === 'outgoing'
        ? 'social.stateNote.outgoing'
        : profile.friendState === 'incoming'
          ? 'social.stateNote.incoming'
          : profile.friendState === 'self'
            ? 'social.stateNote.self'
            : null;
  const relationship = relationshipKey ? t(relationshipKey) : '';

  return (
    <PageScroll title={profile.user.name}>
      <View style={styles.head}>
        <View style={styles.header}>
          <Avatar name={profile.user.name} image={profile.user.image} size={88} />
          <View style={styles.headerText}>
            <Text style={[type.title, text.fg]} numberOfLines={2}>
              {profile.user.name.toUpperCase()}
            </Text>
            <Text style={[type.eyebrow, text.dim]}>@{profile.user.username}</Text>
            {relationship ? (
              <Text style={[type.eyebrow, styles.relationship]}>{relationship}</Text>
            ) : null}
            <FriendAction profile={profile} signedIn={viewer !== null} />
          </View>
        </View>
        {profile.user.bio ? <Text style={[type.body, text.muted]}>{profile.user.bio}</Text> : null}
      </View>

      <Stats>
        <Stat value={profile.stats.titlesTracked} label={t('profile.stats.titles')} />
        <Stat value={profile.stats.completed} label={t('profile.stats.completed')} />
        <Stat value={profile.stats.dayStreak} label={t('home.stats.dayStreak')} />
        <Stat value={profile.friendCount} label={t('social.title')} />
      </Stats>

      {MEDIA_KINDS.map((kind) => {
        const favorites = profile.favorites.filter((entry) => entry.kind === kind);
        if (favorites.length === 0) return null;
        return <FavoriteBlock key={kind} label={labels.kind(kind)} entries={favorites} />;
      })}

      {profile.activity.length > 0 ? (
        <View>
          <SectionTitle title={t('home.activity.title')} />
          <GlassCard style={styles.activityCard}>
            {profile.activity.map((entry, index) => (
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
  const { t } = useTranslation();
  const writeFailed = useWriteFailedToast();
  const { send, accept, remove, busy, sendTo, acceptFrom, removeFrom } =
    useFriendActions(writeFailed);
  const [confirmingUnfriend, setConfirmingUnfriend] = useState(false);

  if (profile.friendState === 'self') {
    return (
      <PrismButton
        label={t('social.editOnYourProfile')}
        variant="secondary"
        onPress={() => router.push('/profile')}
        style={styles.action}
      />
    );
  }

  if (!signedIn) {
    return (
      <PrismButton
        label={t('social.signInToAdd')}
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
          label={t('social.addFriend')}
          icon="plus"
          busy={send.isPending}
          disabled={busy}
          onPress={() => sendTo(profile.user.username)}
          style={styles.action}
        />
      ) : null}
      {profile.friendState === 'outgoing' ? (
        <PrismButton
          label={t('social.requestSentAction')}
          icon="close"
          variant="secondary"
          busy={remove.isPending}
          disabled={busy}
          onPress={() => removeFrom(profile.userId)}
          style={styles.action}
        />
      ) : null}
      {profile.friendState === 'incoming' ? (
        <>
          <PrismButton
            label={t('social.acceptAction')}
            busy={accept.isPending}
            disabled={busy}
            onPress={() => acceptFrom(profile.userId)}
            style={styles.action}
          />
          <PrismButton
            label={t('social.declineAction')}
            variant="secondary"
            disabled={busy}
            onPress={() => removeFrom(profile.userId)}
            style={styles.action}
          />
        </>
      ) : null}
      {profile.friendState === 'friends' ? (
        <PrismButton
          label={t('social.title')}
          icon="check"
          variant="secondary"
          disabled={busy}
          onPress={() => setConfirmingUnfriend(true)}
          style={styles.action}
        />
      ) : null}

      {confirmingUnfriend ? (
        <ConfirmSheet
          title={t('social.unfriend.title')}
          body={`${profile.user.name} goes back to being a stranger, and any list you share with friends only stops being visible to them.`}
          confirmLabel={t('common.removeAction')}
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
      <Shelf>
        {entries.map((entry) => (
          <ShelfItem
            key={entry.id}
            href={`/media/${entry.slug}`}
            kind={entry.kind}
            title={entry.title}
            coverUrl={entry.coverUrl}
          />
        ))}
      </Shelf>
    </View>
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
});
