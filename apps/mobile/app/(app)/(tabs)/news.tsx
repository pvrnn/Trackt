import { FlashList } from '@shopify/flash-list';
import { useNewsFeed } from '@trackt/client';
import type { MediaKind } from '@trackt/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NewsFilterBar } from '../../../src/components/NewsFilterBar';
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
  storyCount,
  windowStart,
  type WindowKey,
} from '../../../src/lib/news-filters';
import { color, gutter, space, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The news feed (`GET /news`, ADR-0005) — one column, not the four-column
 * masonry of `News.dc.html`: two columns of 171pt cards leave no room for a
 * headline. Keyset pages append as you reach the end, so there is no page count
 * to render and no way back.
 */
export default function NewsTab() {
  /** Empty is ALL KINDS: its own row in the menu, not every other row ticked. */
  const [kinds, setKinds] = useState<MediaKind[]>([]);
  const [window, setWindow] = useState<WindowKey>('all');
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
  } = useNewsFeed(filters);

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
              <PageTitle title="News" />
              <StaleNotice updatedAt={updatedAt} />
            </View>
            <View style={styles.secondRow}>
              <NewsFilterBar
                kinds={kinds}
                onKinds={setKinds}
                window={window}
                onWindow={setWindow}
                summary={isLoading ? undefined : storyCount(articles.length, hasMore)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={gutter}>
            {isLoading ? (
              <OfflineFallback>
                <Loading />
              </OfflineFallback>
            ) : isError ? (
              <EmptyState
                title="News is offline"
                body="This instance couldn't reach the catalog's news feed."
              />
            ) : (
              <EmptyState
                title="Nothing yet"
                body={
                  kinds.length > 0 || window !== 'all'
                    ? 'No stories in this filter. Widen the kinds or the date range.'
                    : 'No stories have been published to this instance yet.'
                }
              />
            )}
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <ActivityIndicator color={color.pink} style={styles.footer} />
          ) : articles.length > 0 && !hasMore ? (
            <Text style={[type.eyebrow, text.faint, styles.end]}>END OF THE FEED</Text>
          ) : null
        }
        renderItem={({ item }) => <NewsRow article={item} />}
      />
    </PageFrame>
  );
}

const styles = StyleSheet.create({
  secondRow: {
    marginTop: space.md,
    marginBottom: space.lg,
  },
  footer: {
    paddingVertical: space.xl,
  },
  end: {
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
