import { FlashList } from '@shopify/flash-list';
import { useNewsFeed } from '@trackt/client';
import type { MediaKind } from '@trackt/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilterBar } from '../../../src/components/FilterBar';
import {
  FilterSlab,
  KindDock,
  SlabCell,
  SlabNote,
  SlabRow,
} from '../../../src/components/FilterSlab';
import { NewsRow } from '../../../src/components/NewsRow';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  StaleNotice,
  pullToRefresh,
  useTabContentInset,
} from '../../../src/components/Page';
import {
  WINDOWS,
  kindsFilter,
  useWindowCounts,
  storyCount,
  windowStart,
  type WindowKey,
} from '../../../src/lib/news-filters';
import { color, gutter, layout, space, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The news feed (`GET /news`, ADR-0005) — one column, not the four-column
 * masonry of `News.dc.html`: two columns of 171pt cards leave no room for a
 * headline. Keyset pages append as you reach the end, so there is no page count
 * to render and no way back.
 */
export default function NewsTab() {
  /** Undefined is every kind: the dock's ring, as on Discover. */
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const kinds = useMemo(() => (kind ? [kind] : []), [kind]);
  const [window, setWindow] = useState<WindowKey>('all');
  const { t } = useTranslation();
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();

  const filters = useMemo(() => {
    const days = WINDOWS.find((entry) => entry.key === window)?.days ?? null;
    return { kinds: kindsFilter(kinds), ...(days === null ? {} : { from: windowStart(days) }) };
  }, [kinds, window]);

  const {
    articles,
    updatedAt,
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
    isRefreshing,
    facets,
  } = useNewsFeed(filters);
  const windowCounts = useWindowCounts(kinds);
  const current = WINDOWS.find((entry) => entry.key === window) ?? WINDOWS[3];

  return (
    <PageFrame fadeOnFocus>
      <FlashList
        data={articles}
        keyExtractor={(article) => article.id}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        refreshControl={pullToRefresh(isRefreshing, refresh)}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.lg }}>
            <View style={gutter}>
              <PageTitle title={t('news.title')} />
              <StaleNotice updatedAt={updatedAt} />
            </View>
            {/* Discover's slab: the kind dock, then a cell per remaining filter. */}
            <FilterSlab style={styles.slab}>
              <KindDock kind={kind} onKind={setKind} counts={facets?.kinds} first />
              <SlabRow row>
                <SlabCell>
                  <FilterBar
                    variant="slab"
                    filters={[
                      {
                        key: 'window',
                        icon: 'clock',
                        caption: t('news.when'),
                        label: t(current.labelKey),
                        rows: WINDOWS.map((entry) => ({
                          key: entry.key,
                          label: t(entry.labelKey),
                          count: windowCounts[entry.key],
                          selected: entry.key === window,
                        })),
                        onSelect: (key) => setWindow(key as WindowKey),
                      },
                    ]}
                  />
                </SlabCell>
                {isLoading ? null : <SlabNote>{storyCount(articles.length, hasMore)}</SlabNote>}
              </SlabRow>
            </FilterSlab>
          </View>
        }
        ListEmptyComponent={
          <View style={gutter}>
            {isLoading ? (
              <OfflineFallback>
                <Loading />
              </OfflineFallback>
            ) : isError ? (
              <EmptyState title={t('news.offlineTitle')} body={t('news.offlineBody')} />
            ) : (
              <EmptyState
                title={t('news.empty.title')}
                body={
                  kinds.length > 0 || window !== 'all'
                    ? t('news.empty.filtered')
                    : t('news.empty.unfiltered')
                }
              />
            )}
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <ActivityIndicator color={color.pink} style={styles.footer} />
          ) : articles.length > 0 && !hasMore ? (
            <Text style={[type.eyebrow, text.dim, styles.end]}>{t('news.endOfFeed')}</Text>
          ) : null
        }
        renderItem={({ item }) => <NewsRow article={item} />}
      />
    </PageFrame>
  );
}

const styles = StyleSheet.create({
  slab: {
    marginTop: space.md,
    marginBottom: space.lg,
    marginHorizontal: layout.gutter,
  },
  footer: {
    paddingVertical: space.xl,
  },
  end: {
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
