import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  MIN_MEDIA_SEARCH_QUERY,
  SELECTABLE_YEARS,
  gameSearchContext,
  useDebounced,
  useMediaSearch,
  useSearchKindCounts,
  useShowcase,
  volumeCount,
} from '@trackt/client';
import { useLabels } from '../../../src/lib/labels';
import { useTranslation } from 'react-i18next';
import {
  MEDIA_KINDS,
  type MediaKind,
  type SearchResult,
  type SearchSort,
  type StatusFilter,
} from '@trackt/shared';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import {
  FilterSheet,
  FilterTokens,
  FiltersCell,
} from '../../../src/components/DiscoverFilterPanel';
import { FilterBar, type MenuRow } from '../../../src/components/FilterBar';
import { FilterSlab, KindDock, SlabCell, SlabRow } from '../../../src/components/FilterSlab';
import { Icon } from '../../../src/components/Icon';
import { KindDot } from '../../../src/components/KindDot';
import { Sheet, useSheetController } from '../../../src/components/Sheet';
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
import { color, gutter, layout, space, stroke, surface, text } from '../../../src/theme/tokens';
import { font, type } from '../../../src/theme/typography';

const COLUMNS = 3;
const SORTS: SearchSort[] = ['relevance', 'newest', 'az'];

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
 * The slab's second row is YEAR and FILTERS; FILTERS opens a sheet with STATUS
 * and a genre search, and what it sets shows as tokens under the slab. SORT
 * orders results rather than narrowing them, so it sits beside the result count
 * (`Search.dc.html`), and only once there are results to reorder: the shelf has
 * one order of its own.
 *
 * `Can't find it?` from the mockup is absent by design — entry creation moved to
 * the central catalog, so there is no create route to send anyone to. The
 * tracked mark is absent too: neither endpoint returns the viewer's state.
 */
export default function DiscoverTab() {
  const { user, isPending } = useAuthedScreen();
  const { t } = useTranslation();
  const labels = useLabels();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [genres, setGenres] = useState<string[]>([]);
  const [mediaStatus, setMediaStatus] = useState<StatusFilter | undefined>(undefined);
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filters = { genres, status: mediaStatus };
  const panelActive = genres.length + (mediaStatus ? 1 : 0);
  const narrowed = kind !== undefined || year !== undefined || panelActive > 0;
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
  } = useMediaSearch(debounced, kind, year, sort, filters);
  const kindCounts = useSearchKindCounts(debounced, year, sort, filters);
  // Hits for every filter at once: the picked kind's count, or all of them.
  const hitCount =
    !browsing && kindCounts
      ? kind
        ? (kindCounts[kind] ?? 0)
        : MEDIA_KINDS.reduce((sum, value) => sum + (kindCounts[value] ?? 0), 0)
      : undefined;
  const {
    data: showcase,
    isPending: showcasePending,
    isPlaceholder: showcasePlaceholder,
    hasMore: showcaseMore,
    loadMore: loadShowcase,
    loadingMore: showcaseLoadingMore,
  } = useShowcase(kind, year, filters);
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
  }, [browsing, kind, year, sort, genres, mediaStatus]);

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

  // The server's count when it has one; otherwise only a fully loaded list's.
  const resultCount =
    hitCount ?? (items.length > 0 && !hasNext && !showSkeleton ? items.length : undefined);
  const countLabel =
    resultCount !== undefined
      ? t(resultCount === 1 ? 'discover.resultCount_one' : 'discover.resultCount_other', {
          count: resultCount,
        })
      : null;
  const sortLabels: Record<SearchSort, string> = {
    relevance: t('discover.sortRelevance'),
    newest: t('discover.sortNewest'),
    az: t('discover.sortAz'),
  };
  const panelProps = {
    genres,
    status: mediaStatus,
    onGenres: setGenres,
    onStatus: setMediaStatus,
  };

  const emptyBrowse =
    kind !== undefined || year !== undefined || panelActive > 0
      ? t('discover.browseEmpty')
      : t('discover.emptyInitial');
  const emptyResults = panelActive
    ? t('discover.emptyFiltered', { query: trimmed })
    : kind
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
    <EmptyState title={t('discover.title')} body={emptyBrowse} />
  ) : (
    <EmptyState title={t('common.unknown')} body={emptyResults} />
  );

  return (
    <PageFrame fadeOnFocus>
      <View style={{ paddingTop: insets.top + space.lg }}>
        <View style={gutter}>
          <PageTitle title={t('discover.title')} />
          <FilterSlab style={styles.slab}>
            <View style={styles.queryRow}>
              <Icon name="search" color={color.muted} size={18} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('discover.searchPlaceholder')}
                placeholderTextColor={color.dim}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={t('discover.searchAria')}
                style={styles.input}
              />
            </View>
            <KindDock kind={kind} onKind={setKind} counts={browsing ? undefined : kindCounts} />
            <SlabRow row>
              <SlabCell>
                <FilterBar
                  variant="slab"
                  filters={[
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
              </SlabCell>
              <FiltersCell active={panelActive} onPress={() => setSheetOpen(true)} />
            </SlabRow>
          </FilterSlab>
          <FilterTokens {...panelProps} />
        </View>
        {sheetOpen ? (
          <FilterSheet
            {...panelProps}
            kind={kind}
            total={hitCount}
            onClose={() => setSheetOpen(false)}
          />
        ) : null}
        {sortOpen ? (
          <SortSheet
            value={sort}
            labels={sortLabels}
            onPick={setSort}
            onClose={() => setSortOpen(false)}
          />
        ) : null}
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
          items.length > 0 && !showSkeleton ? (
            <View style={styles.section}>
              <SectionTitle
                title={browsing && !narrowed ? t('discover.onThisInstance') : t('discover.results')}
                action={
                  <View style={styles.resultTools}>
                    {countLabel ? (
                      <Text style={[styles.count, text.dim, !browsing && styles.countDivided]}>
                        {countLabel.toUpperCase()}
                      </Text>
                    ) : null}
                    {/* The shelf has one order of its own; SORT reorders results. */}
                    {!browsing ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('discover.sort')}: ${sortLabels[sort]}`}
                        hitSlop={8}
                        onPress={() => setSortOpen(true)}
                        style={({ pressed }) => [
                          styles.sortTrigger,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <Text style={styles.sortCaption}>{t('discover.sort')}</Text>
                        <Text style={styles.sortValue}>{sortLabels[sort].toUpperCase()}</Text>
                        <Icon name="caret-down" color={color.muted} size={10} />
                      </Pressable>
                    ) : null}
                  </View>
                }
              />
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

function SortSheet({
  value,
  labels,
  onPick,
  onClose,
}: {
  value: SearchSort;
  labels: Record<SearchSort, string>;
  onPick: (sort: SearchSort) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sheet = useSheetController(onClose);
  return (
    <Sheet title={t('discover.sort')} controller={sheet}>
      {SORTS.map((option) => {
        const on = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              onPick(option);
              sheet.dismiss();
            }}
            style={({ pressed }) => [
              styles.sortRow,
              on && styles.sortRowOn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.sortRowLabel, { color: on ? color.pink : color.muted }]}>
              {labels[option].toUpperCase()}
            </Text>
            {on ? <Icon name="check" color={color.pink} size={16} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function ResultTile({ result, width }: { result: SearchResult; width: number }) {
  const { t } = useTranslation();
  const labels = useLabels();
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
  // A series row is one season (ADR-0003): the chip names it, and the year beside
  // the kind is what tells four same-titled seasons apart.
  const volumes = volumeCount(result.metadata ?? {});
  const span = result.seasonNumber
    ? t('discover.seasonChip', { number: result.seasonNumber })
    : volumes
      ? t('discover.volumeChip', { count: volumes })
      : null;
  return (
    <Touchable href={`/media/${result.slug}`} style={styles.tile}>
      <Cover
        kind={result.kind}
        title={result.title}
        coverUrl={result.coverUrl}
        width={width}
        showTitle={false}
      />
      <Text style={[type.bodySm, styles.tileTitle]} numberOfLines={2}>
        {result.title}
      </Text>
      <View style={styles.metaRow}>
        <KindDot kind={result.kind} />
        <Text style={[styles.meta, text.muted]} numberOfLines={1}>
          {labels.kindSingular(result.kind).toUpperCase()}
          {result.year ? <Text style={text.dim}>{` · ${result.year}`}</Text> : null}
        </Text>
        {span ? <Text style={styles.chip}>{span.toUpperCase()}</Text> : null}
      </View>
      {context ? (
        <Text style={[type.bodySm, text.muted, styles.gameContext]} numberOfLines={2}>
          {context}
        </Text>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  slab: {
    marginTop: space.lg,
    marginBottom: space.lg,
  },
  queryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    padding: 0,
    fontFamily: font.body,
    fontSize: 16,
    color: color.fg,
  },
  resultTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  countDivided: {
    paddingRight: space.sm,
    borderRightWidth: stroke,
    borderRightColor: 'rgba(255,255,255,0.12)',
  },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 36,
    paddingHorizontal: space.sm,
  },
  sortCaption: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.dim,
  },
  sortValue: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: 0.72,
    color: color.fg,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.touchTarget,
    paddingHorizontal: space.md,
    borderRadius: 10,
  },
  sortRowOn: {
    backgroundColor: surface.pinkRow,
  },
  sortRowLabel: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: 0.96,
  },
  hint: {
    marginTop: -space.xs,
    marginBottom: space.md,
  },
  count: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
  },
  section: {
    paddingTop: space.xs,
  },
  tile: {
    marginBottom: 18,
    marginRight: space.md,
    gap: 7,
  },
  tileTitle: {
    color: color.fg,
    fontFamily: font.bodySemibold,
    lineHeight: 16,
  },
  gameContext: {
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 6,
    rowGap: 5,
  },
  meta: {
    flexShrink: 1,
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  chip: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.6,
    color: color.fg,
    backgroundColor: surface.divider,
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
