import { updatedLabel, useLists, visibilityLabel } from '@trackt/client';
import type { ListSummary } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Cover } from '../../../src/components/Cover';
import { BackLink, EmptyState, Loading, PageScroll, PageTitle } from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { color, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The viewer's lists (`GET /lists`), reached from Profile.
 *
 * `Lists.dc.html`'s MY LISTS / FOLLOWING / COLLABORATIVE tabs are not drawn:
 * `ListsQuerySchema.scope` admits only `mine`, so two of the three would be
 * permanently empty. Web renders them visibly inert to hold the shape of the
 * mockup; a phone has no room to spend on a control that cannot do anything.
 * Creating and editing lists is phase 3 — this screen reads.
 */
export default function ListsScreen() {
  const { data, isPending, isError } = useLists();

  return (
    <PageScroll>
      <View style={styles.head}>
        <BackLink label="Profile" />
        <PageTitle title="Lists" count={data ? `${data.length} lists` : undefined} />
      </View>

      {isPending ? (
        <Loading />
      ) : isError || !data ? (
        <EmptyState title="Couldn't load" body="The instance didn't answer." />
      ) : data.length === 0 ? (
        <EmptyState
          title="No lists yet"
          body="Lists group titles however you like — a watchlist, a top ten, a seasonal shortlist."
        />
      ) : (
        <View style={styles.cards}>
          {data.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </View>
      )}
    </PageScroll>
  );
}

function ListCard({ list }: { list: ListSummary }) {
  return (
    <Touchable href={`/lists/${list.id}`} style={styles.card}>
      {list.covers.length > 0 ? (
        <View style={styles.fan}>
          {list.covers.slice(0, 4).map((cover, index) => (
            <Cover
              key={`${cover.title}-${index}`}
              kind={cover.kind}
              title={cover.title}
              coverUrl={cover.coverUrl}
              width={56}
              showTitle={false}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[type.section, styles.fg]} numberOfLines={2}>
          {list.title.toUpperCase()}
        </Text>
        {list.description ? (
          <Text style={[type.bodySm, styles.muted]} numberOfLines={2}>
            {list.description}
          </Text>
        ) : null}
        <View style={styles.badges}>
          {list.isRanked ? <Text style={[type.eyebrow, styles.badge]}>RANKED</Text> : null}
          {list.isCollaborative ? <Text style={[type.eyebrow, styles.badge]}>COLLAB</Text> : null}
        </View>
        <Text style={[type.eyebrow, styles.dim]}>
          {list.itemCount} {list.itemCount === 1 ? 'TITLE' : 'TITLES'} ·{' '}
          {visibilityLabel(list.visibility).toUpperCase()} · {updatedLabel(list.updatedAt)}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.sm,
  },
  cards: {
    gap: space.md,
  },
  card: {
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  fan: {
    flexDirection: 'row',
    gap: space.sm,
  },
  body: {
    gap: space.sm,
  },
  badges: {
    flexDirection: 'row',
    gap: space.sm,
  },
  badge: {
    color: color.pink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.pink,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
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
