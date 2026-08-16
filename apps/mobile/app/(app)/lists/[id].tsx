import { KIND_LABELS_SINGULAR, updatedLabel, useList, visibilityLabel } from '@trackt/client';
import type { ListEntry } from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Cover } from '../../../src/components/Cover';
import { KindDot } from '../../../src/components/KindDot';
import { BackLink, EmptyState, Loading, PageScroll, PageTitle } from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { PrismText } from '../../../src/components/PrismText';
import { color, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * One opened list (`GET /lists/:id`).
 *
 * A ranked list numbers its rows in the PRISM gradient and leads with the
 * *owner's* score, which is what makes someone else's ranking legible — not the
 * viewer's own rating of the same title. Reordering and removal are owner
 * actions, and they are phase 3.
 */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: list, isPending, isError } = useList(id);

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

  return (
    <PageScroll>
      <View style={styles.head}>
        <BackLink label="Lists" />
        <PageTitle
          title={list.title}
          count={`${list.itemCount} ${list.itemCount === 1 ? 'title' : 'titles'}`}
        />
        {list.description ? (
          <Text style={[type.body, styles.muted]}>{list.description}</Text>
        ) : null}
        <Text style={[type.eyebrow, styles.dim]}>
          {list.isOwner ? 'YOURS' : `@${list.owner.username}`} ·{' '}
          {visibilityLabel(list.visibility).toUpperCase()} · {updatedLabel(list.updatedAt)}
        </Text>
      </View>

      {list.entries.length === 0 ? (
        <EmptyState title="Empty list" body="Nothing has been added to this list yet." />
      ) : (
        <View style={styles.rows}>
          {list.entries.map((entry, index) => (
            <Row key={entry.id} entry={entry} rank={list.isRanked ? index + 1 : null} />
          ))}
        </View>
      )}
    </PageScroll>
  );
}

function Row({ entry, rank }: { entry: ListEntry; rank: number | null }) {
  return (
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
        <Text style={[type.cardTitle, styles.fg]} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <KindDot kind={entry.kind} />
          <Text style={[type.eyebrow, styles.dim]}>
            {KIND_LABELS_SINGULAR[entry.kind]}
            {entry.year ? ` · ${entry.year}` : ''}
          </Text>
        </View>
      </View>
      {entry.ownerScore !== null ? (
        <Text style={[type.label, styles.score]}>{entry.ownerScore}</Text>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.sm,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.cardSm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
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
  fg: {
    color: color.fg,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
  score: {
    color: color.pink,
  },
});
