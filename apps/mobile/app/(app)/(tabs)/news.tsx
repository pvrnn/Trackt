import { FlashList } from '@shopify/flash-list';
import { KIND_LABELS, TOPIC_LABELS, formatNewsDate, todayIso, useNewsFeed } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind, type NewsArticleSummary } from '@trackt/shared';
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, ChipRow } from '../../../src/components/Chip';
import { Cover } from '../../../src/components/Cover';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  StaleNotice,
  useTabContentInset,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/** The mockup's date filter, as the four windows it actually offers. */
const WINDOWS = [
  { key: 'all', label: 'All time', days: null },
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

/** `days` before today, as the ISO date the feed's `from` bound takes. */
function windowStart(days: number): string {
  const today = todayIso();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

/**
 * The news feed (`GET /news`, ADR-0005) — one column, not the four-column
 * masonry of `News.dc.html`. Masonry does not survive 362pt: two columns of
 * 171pt cards leave no room for a headline, and packing shortest-column-first
 * only means something when there is more than one column to balance.
 *
 * Keyset pages append as you reach the end, which is what the cursor contract
 * is shaped for — there is no page count to render, and no way back.
 */
export default function NewsTab() {
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const [window, setWindow] = useState<WindowKey>('all');
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();

  const filters = useMemo(() => {
    const days = WINDOWS.find((entry) => entry.key === window)?.days ?? null;
    return { kind, ...(days === null ? {} : { from: windowStart(days) }) };
  }, [kind, window]);

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
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={color.pink}
            colors={[color.pink]}
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + space.lg }}>
            <View style={styles.gutter}>
              <PageTitle
                title="News"
                count={
                  articles.length > 0
                    ? `${articles.length} ${articles.length === 1 ? 'story' : 'stories'}`
                    : undefined
                }
              />
              <StaleNotice updatedAt={updatedAt} />
            </View>
            <ChipRow>
              <Chip label="All" selected={kind === undefined} onPress={() => setKind(undefined)} />
              {MEDIA_KINDS.map((value) => (
                <Chip
                  key={value}
                  label={KIND_LABELS[value]}
                  selected={kind === value}
                  onPress={() => setKind(kind === value ? undefined : value)}
                />
              ))}
            </ChipRow>
            <View style={styles.secondRow}>
              <ChipRow>
                {WINDOWS.map((entry) => (
                  <Chip
                    key={entry.key}
                    label={entry.label}
                    selected={window === entry.key}
                    onPress={() => setWindow(entry.key)}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.gutter}>
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
                  kind || window !== 'all'
                    ? 'No stories in this filter. Widen the kind or the date range.'
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
            <Text style={[type.eyebrow, styles.end]}>END OF THE FEED</Text>
          ) : null
        }
        renderItem={({ item }) => <NewsRow article={item} />}
      />
    </PageFrame>
  );
}

function NewsRow({ article }: { article: NewsArticleSummary }) {
  const kind = article.kinds[0];
  return (
    <Touchable href={`/news/${article.slug}`} style={styles.card}>
      {kind ? (
        <Cover
          kind={kind}
          title={article.title}
          coverUrl={article.coverUrl}
          width={72}
          showTitle={false}
        />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={[type.eyebrow, styles.tag]}>{TOPIC_LABELS[article.topic]}</Text>
          {kind ? <KindDot kind={kind} /> : null}
          <Text style={[type.eyebrow, styles.dim]}>{formatNewsDate(article.publishedAt)}</Text>
        </View>
        <Text style={[type.cardTitle, styles.title]} numberOfLines={3}>
          {article.title}
        </Text>
        {article.dek ? (
          <Text style={[type.bodySm, styles.dek]} numberOfLines={3}>
            {article.dek}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: layout.gutter,
  },
  secondRow: {
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  card: {
    flexDirection: 'row',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.cardSm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  cardBody: {
    flex: 1,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  tag: {
    color: color.pink,
  },
  title: {
    color: color.fg,
  },
  dek: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
  footer: {
    paddingVertical: space.xl,
  },
  end: {
    color: color.faint,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
