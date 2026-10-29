import { updatedLabel, useFlag, useLists, visibilityLabel } from '@trackt/client';
import type { ListSummary } from '@trackt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Cover } from '../../../src/components/Cover';
import { ListFormSheet } from '../../../src/components/ListFormSheet';
import { EmptyState, PageScroll, PageTitle, QueryState } from '../../../src/components/Page';
import { PrismButton } from '../../../src/components/PrismButton';
import { Touchable } from '../../../src/components/Touchable';
import { color, radius, space, stroke, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The viewer's lists (`GET /lists`), reached from Profile.
 *
 * `Lists.dc.html`'s MY LISTS / FOLLOWING / COLLABORATIVE tabs are not drawn:
 * `ListsQuerySchema.scope` admits only `mine`, so two of the three would be
 * permanently empty. Web renders them visibly inert to hold the shape of the
 * mockup; a phone has no room to spend on a control that cannot do anything.
 *
 * Phase 3 adds the one write this screen owns — creating a list, which then
 * opens so the next thing you do is fill it.
 */
export default function ListsScreen() {
  const { data, dataUpdatedAt, isPending, isError } = useLists();
  const listsOn = useFlag('lists.custom');
  const router = useRouter();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  if (!listsOn) {
    return (
      <PageScroll title={t('lists.title')}>
        <EmptyState title={t('lists.unavailableTitle')} body={t('lists.unavailableBody')} />
      </PageScroll>
    );
  }

  return (
    <PageScroll title={t('lists.title')}>
      <View style={styles.head}>
        <PageTitle title={t('lists.title')} count={data ? `${data.length} lists` : undefined} />
        <PrismButton
          label={t('lists.dialog.title')}
          icon="plus"
          onPress={() => setCreating(true)}
          style={styles.newList}
        />
      </View>

      <QueryState
        query={{ data, isPending, isError, dataUpdatedAt }}
        error={{ title: t('media.loadFailed.title'), body: t('lists.loadError') }}
      >
        {(lists) =>
          lists.length === 0 ? (
            <EmptyState title={t('lists.emptyTitle')} body={t('lists.emptyBody')} />
          ) : (
            <View style={styles.cards}>
              {lists.map((list) => (
                <ListCard key={list.id} list={list} />
              ))}
            </View>
          )
        }
      </QueryState>

      {creating ? (
        <ListFormSheet
          onClose={() => setCreating(false)}
          // Straight into the empty list: the next thing anyone does after
          // naming one is add a title to it.
          onSaved={(saved) => router.push(`/lists/${saved.id}`)}
        />
      ) : null}
    </PageScroll>
  );
}

function ListCard({ list }: { list: ListSummary }) {
  const { t } = useTranslation();
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
        <Text style={[type.section, text.fg]} numberOfLines={2}>
          {list.title.toUpperCase()}
        </Text>
        {list.description ? (
          <Text style={[type.bodySm, text.muted]} numberOfLines={2}>
            {list.description}
          </Text>
        ) : null}
        <View style={styles.badges}>
          {list.isRanked ? <Text style={[type.eyebrow, styles.badge]}>RANKED</Text> : null}
          {list.isCollaborative ? <Text style={[type.eyebrow, styles.badge]}>COLLAB</Text> : null}
        </View>
        <Text style={[type.eyebrow, text.dim]}>
          {t('lists.titles', { count: list.itemCount })} ·{' '}
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
  newList: {
    alignSelf: 'flex-start',
  },
  cards: {
    gap: space.md,
  },
  card: {
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: stroke,
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
    borderWidth: stroke,
    borderColor: color.pink,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
});
