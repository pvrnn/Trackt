import {
  KIND_LABELS_SINGULAR,
  listsApi,
  updatedLabel,
  useList,
  useListsInvalidator,
  visibilityLabel,
} from '@trackt/client';
import type { ListEntry } from '@trackt/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ConfirmSheet } from '../../../src/components/ConfirmSheet';
import { Cover } from '../../../src/components/Cover';
import { Icon, type IconName } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import { ListFormSheet } from '../../../src/components/ListFormSheet';
import { BackLink, EmptyState, Loading, PageScroll, PageTitle } from '../../../src/components/Page';
import { PrismButton } from '../../../src/components/PrismButton';
import { PrismText } from '../../../src/components/PrismText';
import { Touchable } from '../../../src/components/Touchable';
import { commitHaptic, errorHaptic } from '../../../src/lib/haptics';
import { duration } from '../../../src/lib/motion';
import { useWriteFailedToast } from '../../../src/lib/toast';
import { color, layout, radius, space, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * One opened list (`GET /lists/:id`), and the owner's controls over it.
 *
 * A ranked list numbers its rows in the PRISM gradient and leads with the
 * *owner's* score, which is what makes someone else's ranking legible — not the
 * viewer's own rating of the same title.
 *
 * Every write here re-reads from the server rather than patching the cache:
 * positions, counts and the cover fan are all derived server-side, so an
 * optimistic reorder would have to re-implement the rules that produce them.
 * The list is short and the round trip is one request.
 */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: list, isPending, isError } = useList(id);
  const invalidate = useListsInvalidator();
  const writeFailed = useWriteFailedToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Guards re-entrant mutations without disabling the control that fired them:
  // ↑/↓ are tapped in bursts, and a button that disables itself mid-burst moves
  // out from under the thumb.
  const inFlight = useRef(false);

  if (isPending) {
    return (
      <PageScroll>
        <BackLink label="Lists" />
        <Loading />
      </PageScroll>
    );
  }

  if (isError || !list) {
    return (
      <PageScroll>
        <BackLink label="Lists" />
        <EmptyState
          title="List unavailable"
          body="It may have been deleted, or it may not be visible to you."
        />
      </PageScroll>
    );
  }

  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await action();
      commitHaptic();
      invalidate(list.id);
    } catch (cause) {
      errorHaptic();
      writeFailed(cause);
    } finally {
      inFlight.current = false;
    }
  };

  const reorderable = list.isOwner && list.isRanked && list.entries.length > 1;

  return (
    <PageScroll>
      <View style={styles.head}>
        <BackLink label="Lists" />
        <PageTitle
          title={list.title}
          count={`${list.itemCount} ${list.itemCount === 1 ? 'title' : 'titles'}`}
        />
        {list.description ? <Text style={[type.body, text.muted]}>{list.description}</Text> : null}
        <Text style={[type.eyebrow, text.dim]}>
          {list.isOwner ? 'YOURS' : `@${list.owner.username}`} ·{' '}
          {visibilityLabel(list.visibility).toUpperCase()} · {updatedLabel(list.updatedAt)}
        </Text>
        {list.isOwner ? (
          <View style={styles.ownerActions}>
            <PrismButton label="Edit" variant="secondary" onPress={() => setEditing(true)} />
            <PrismButton
              label="Delete list"
              variant="secondary"
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        ) : null}
        {reorderable ? (
          <Text style={[type.eyebrow, text.dim]}>USE THE ARROWS TO REORDER</Text>
        ) : null}
      </View>

      {list.entries.length === 0 ? (
        <EmptyState
          title="Empty list"
          body={
            list.isOwner
              ? 'Open a title and use its LIST button to put it here.'
              : 'Nothing has been added to this list yet.'
          }
        />
      ) : (
        <View style={styles.rows}>
          {list.entries.map((entry, index) => (
            // The reorder is not optimistic — ↑/↓ wait for the server, because
            // a ranked list's positions are its own (see above). What the
            // layout transition adds is the only thing missing once the new
            // order arrives: which row moved. Without it two rows swap between
            // frames and the eye has to re-read the list to find out.
            <Animated.View key={entry.id} layout={LinearTransition.duration(duration.commit)}>
              <Row
                entry={entry}
                rank={list.isRanked ? index + 1 : null}
                owner={list.isOwner}
                reorderable={reorderable}
                first={index === 0}
                last={index === list.entries.length - 1}
                onMove={(direction) =>
                  void run(() => listsApi.moveItem(list.id, entry.id, direction))
                }
                onRemove={() => void run(() => listsApi.removeItem(list.id, entry.id))}
              />
            </Animated.View>
          ))}
        </View>
      )}

      {editing ? <ListFormSheet list={list} onClose={() => setEditing(false)} /> : null}

      {confirmingDelete ? (
        <ConfirmSheet
          title="Delete list"
          body={`“${list.title}” and its ${list.itemCount} ${
            list.itemCount === 1 ? 'title' : 'titles'
          } go for good. The titles themselves stay in your library.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await listsApi.remove(list.id);
            invalidate();
            router.replace('/lists');
          }}
          onClose={() => setConfirmingDelete(false)}
        />
      ) : null}
    </PageScroll>
  );
}

function Row({
  entry,
  rank,
  owner,
  reorderable,
  first,
  last,
  onMove,
  onRemove,
}: {
  entry: ListEntry;
  rank: number | null;
  owner: boolean;
  reorderable: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.rowWrap}>
      <Touchable href={`/media/${entry.slug}`} style={styles.row}>
        {rank !== null ? (
          <View style={styles.rank}>
            <PrismText style={type.stat}>{String(rank).padStart(2, '0')}</PrismText>
          </View>
        ) : null}
        <Cover
          kind={entry.kind}
          title={entry.title}
          coverUrl={entry.coverUrl}
          width={44}
          showTitle={false}
        />
        <View style={styles.body}>
          <Text style={[type.cardTitle, text.fg]} numberOfLines={2}>
            {entry.title}
          </Text>
          <View style={styles.metaRow}>
            <KindDot kind={entry.kind} />
            <Text style={[type.eyebrow, text.dim]}>
              {KIND_LABELS_SINGULAR[entry.kind]}
              {entry.year ? ` · ${entry.year}` : ''}
            </Text>
          </View>
        </View>
        {entry.ownerScore !== null ? (
          <Text style={[type.label, styles.score]}>{entry.ownerScore}</Text>
        ) : null}
      </Touchable>

      {owner ? (
        <View style={styles.rowActions}>
          {reorderable ? (
            <>
              <IconButton
                icon="arrow-up"
                label={`Move ${entry.title} up`}
                disabled={first}
                onPress={() => onMove('up')}
              />
              <IconButton
                icon="arrow-down"
                label={`Move ${entry.title} down`}
                disabled={last}
                onPress={() => onMove('down')}
              />
            </>
          ) : null}
          <IconButton
            icon="close"
            label={`Remove ${entry.title} from this list`}
            onPress={onRemove}
          />
        </View>
      ) : null}
    </View>
  );
}

function IconButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: 'rgba(217,107,176,0.12)', borderless: true }}
      style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.25 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} color={color.dim} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.sm,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
  },
  rows: {
    gap: space.sm,
  },
  rowWrap: {
    borderRadius: radius.cardSm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surface.divider,
  },
  icon: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank: {
    minWidth: 36,
  },
  body: {
    flex: 1,
    gap: space.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  score: {
    color: color.pink,
  },
});
