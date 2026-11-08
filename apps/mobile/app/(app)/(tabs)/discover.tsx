import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  MIN_MEDIA_SEARCH_QUERY,
  SELECTABLE_YEARS,
  gameSearchContext,
  useDebounced,
  useMediaSearch,
  useShowcase,
} from '@trackt/client';
import { useLabels } from '../../../src/lib/labels';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type MediaKind, type SearchResult } from '@trackt/shared';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import { FilterBar, type MenuRow } from '../../../src/components/FilterBar';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  OfflineFallback,
  PageFrame,
  PageTitle,
  SectionTitle,
  useTabContentInset,
} from '../../../src/components/Page';
import { SearchSkeleton } from '../../../src/components/Skeleton';
import { Touchable } from '../../../src/components/Touchable';
import { useAuthedScreen } from '../../../src/lib/session';
import {
  color,
  gutter,
  layout,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

const COLUMNS = 3;

/**
 * Discover (`Search.dc.html`), the instance catalog's search over
 * `GET /search?q=&kind=&year=` and the shelf it opens on.
 *
 * The 250 ms debounce is not a nicety: the endpoint's rate bucket is 60/min, and
 * an unthrottled `onChangeText` spends that in four seconds of typing. Web gets
 * its debounce from the URL `?q=` sync; there is no URL here, so `useDebounced`
 * is the one that does it.
 *
 * Nothing typed is not an empty page: it is the instance's own catalog
 * (`GET /media/showcase`), narrowed by the same kind chips and year the results
 * are, and paged the same way. A query too short to run keeps that shelf under
 * a hint rather than replacing it, because typing `t` on the way to a title
 * should not take the page away twice as fast as it arrived.
 *
 * `Can't find it?` from the mockup is absent by design — entry creation moved to
 * the central catalog, so there is no create route to send anyone to.
 */
export default function DiscoverTab() {
  const { user, isPending } = useAuthedScreen();
  const { t } = useTranslation();
  const labels = useLabels();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const [year, setYear] = useState<number | undefined>(undefined);
  const debounced = useDebounced(query, 250);
  const trimmed = debounced.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_MEDIA_SEARCH_QUERY;
  const browsing = trimmed.length < MIN_MEDIA_SEARCH_QUERY;
  const {
    status,
    results,
    isPlaceholder: resultsPlaceholder,
    hasMore,
    loadMore,
    loadingMore,
  } = useMediaSearch(debounced, kind, year);
  const {
    data: showcase,
    isPending: showcasePending,
    isPlaceholder: showcasePlaceholder,
    hasMore: showcaseMore,
    loadMore: loadShowcase,
    loadingMore: showcaseLoadingMore,
  } = useShowcase(kind, year);
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlashListRef<SearchResult>>(null);

  // One grid, two sources: the shelf until a query is long enough to search,
  // then the results. Paging follows whichever is showing.
  const items = browsing ? showcase : results;
  const hasNext = browsing ? showcaseMore : hasMore;
  const loadingNext = browsing ? showcaseLoadingMore : loadingMore;
  const loadNext = browsing ? loadShowcase : loadMore;
  // A grid's contents answer the current query: while a new key loads — a
  // filter change or a typed query — the tiles on screen answer the old one, so
  // they are replaced by the same skeleton the first load shows. TanStack's
  // `isLoading` (`isPending`) is already false by then: `keepPreviousData` hands
  // over the old rows, so the hook's `status` is the signal. `isPlaceholder`
  // narrows it to a different key — a background refetch of the key already
  // shown, and a next page, keep their covers.
  const loading = browsing ? showcasePending : status === 'loading';
  const previousKey = browsing ? showcasePlaceholder : resultsPlaceholder;
  const showSkeleton = loading && (items.length === 0 || previousKey);

  // The header is fixed above the grid, so a filter is reachable from any depth
  // — and a new source under the old offset would open mid-list with its
  // heading gone. Every switch starts at the top instead.
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [browsing, kind, year]);

  const kindRows: MenuRow[] = [
    { key: 'all', label: t('news.allKinds'), selected: kind === undefined },
    ...MEDIA_KINDS.map((value) => ({
      key: value,
      label: labels.kind(value),
      selected: kind === value,
    })),
  ];
  // Static from next year down to 1900, not a facet of what this instance holds:
  // a fresh self-host has materialized almost nothing and the central catalog
  // answers for the rest.
  const yearRows: MenuRow[] = [
    { key: 'any', label: t('discover.anyYear'), selected: year === undefined },
    ...SELECTABLE_YEARS.map((value) => ({
      key: String(value),
      label: String(value),
      selected: year === value,
    })),
  ];

  const heading = browsing
    ? kind
      ? t('discover.browseKind', { kind: labels.kind(kind) })
      : t('discover.browse')
    : t('discover.results');

  const emptyBrowse =
    kind !== undefined || year !== undefined
      ? t('discover.browseEmpty')
      : t('discover.emptyInitial');
  const emptyResults = kind
    ? year
      ? t('discover.emptyInKindYear', {
          query: trimmed,
          kind: labels.kind(kind).toLowerCase(),
          year,
        })
      : t('discover.emptyInKind', { query: trimmed, kind: labels.kind(kind).toLowerCase() })
    : year
      ? t('discover.emptyInYear', { query: trimmed, year })
      : t('discover.empty', { query: trimmed });

  // The grid is measured, not guessed: the columns share whatever is left of the
  // screen after the gutters and the gaps between them.
  const columnWidth = Math.floor((width - layout.gutter * 2 - space.md * (COLUMNS - 1)) / COLUMNS);

  if (isPending || !user) {
    return (
      <PageFrame fadeOnFocus>
        <Loading />
      </PageFrame>
    );
  }

  const emptyState = showSkeleton ? (
    <OfflineFallback>
      <SearchSkeleton />
    </OfflineFallback>
  ) : !browsing && status === 'error' ? (
    <EmptyState title={t('errors.searchFailed')} body={t('errors.searchFailed')} />
  ) : browsing ? (
    <EmptyState
      title={kind !== undefined || year !== undefined ? heading : t('discover.title')}
      body={emptyBrowse}
    />
  ) : (
    <EmptyState title={t('common.unknown')} body={emptyResults} />
  );

  return (
    <PageFrame fadeOnFocus>
      <View style={{ paddingTop: insets.top + space.lg }}>
        <View style={gutter}>
          <PageTitle
            title={t('discover.title')}
            count={
              !browsing && status === 'success' && results.length > 0
                ? t(
                    results.length === 1
                      ? 'discover.resultCount_one'
                      : 'discover.resultCount_other',
                    { count: results.length },
                  )
                : undefined
            }
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('discover.searchPlaceholder')}
            placeholderTextColor={color.faint}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('discover.searchAria')}
            style={[type.body, styles.input]}
          />
        </View>
        <View style={styles.filters}>
          <FilterBar
            variant="columns"
            filters={[
              {
                key: 'kind',
                icon: 'list',
                caption: t('discover.kind'),
                label: kind ? labels.kind(kind) : t('news.allKinds'),
                rows: kindRows,
                onSelect: (key) => setKind(key === 'all' ? undefined : (key as MediaKind)),
              },
              {
                key: 'year',
                icon: 'clock',
                caption: t('discover.year'),
                label: year === undefined ? t('discover.anyYear') : String(year),
                rows: yearRows,
                onSelect: (key) => setYear(key === 'any' ? undefined : Number(key)),
              },
            ]}
          />
        </View>
        {tooShort ? (
          <Text style={[type.bodySm, text.muted, gutter, styles.hint]}>
            {t('discover.minQuery', { count: MIN_MEDIA_SEARCH_QUERY })}
          </Text>
        ) : null}
      </View>

      <FlashList
        ref={list}
        data={showSkeleton ? [] : items}
        numColumns={COLUMNS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: bottomInset }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!showSkeleton && hasNext && !loadingNext) loadNext();
        }}
        ListHeaderComponent={
          items.length > 0 ? (
            <View style={styles.section}>
              <SectionTitle title={heading} />
            </View>
          ) : null
        }
        ListEmptyComponent={emptyState}
        ListFooterComponent={loadingNext && !showSkeleton ? <SearchSkeleton count={3} /> : null}
        renderItem={({ item }) => <ResultTile result={item} width={columnWidth} />}
      />
    </PageFrame>
  );
}

function ResultTile({ result, width }: { result: SearchResult; width: number }) {
  const { t } = useTranslation();
  const gameContext = gameSearchContext(result.kind, result.metadata ?? {});
  const context = [
    gameContext?.editionTitle
      ? t('discover.gameEdition', { name: gameContext.editionTitle })
      : gameContext?.role
        ? t(`discover.gameRole.${gameContext.role}`)
        : null,
    gameContext?.parentTitle ? t('discover.gameFor', { title: gameContext.parentTitle }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // A series row is one season (ADR-0003), so the season is worth saying — but
  // it does not replace the year, which is what tells four same-titled seasons
  // apart. Same order as the media page's own meta line.
  const meta = [result.year, result.seasonNumber ? `S${result.seasonNumber}` : null]
    .filter((value) => value !== null && value !== undefined)
    .join(' · ');
  return (
    <Touchable href={`/media/${result.slug}`} style={styles.tile}>
      <Cover kind={result.kind} title={result.title} coverUrl={result.coverUrl} width={width} />
      <Text style={[type.bodySm, styles.tileTitle]} numberOfLines={2}>
        {result.title}
      </Text>
      <View style={styles.metaRow}>
        <KindDot kind={result.kind} />
        <Text style={[type.eyebrow, text.dim]} numberOfLines={1}>
          {meta || '—'}
        </Text>
      </View>
      {context ? (
        <Text style={[type.bodySm, text.dim, styles.gameContext]} numberOfLines={2}>
          {context}
        </Text>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  filters: {
    marginVertical: space.md,
  },
  hint: {
    marginTop: -space.xs,
    marginBottom: space.md,
  },
  input: {
    minHeight: layout.touchTarget,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: surface.glassWell,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    color: color.fg,
  },
  section: {
    paddingTop: space.xs,
  },
  tile: {
    marginBottom: space.lg,
    marginRight: space.md,
    gap: space.xs,
  },
  tileTitle: {
    color: color.fg,
  },
  gameContext: {
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
