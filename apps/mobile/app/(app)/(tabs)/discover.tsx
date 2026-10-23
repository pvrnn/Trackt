import { FlashList } from '@shopify/flash-list';
import { useDebounced, useMediaSearch } from '@trackt/client';
import { useLabels } from '../../../src/lib/labels';
import { useTranslation } from 'react-i18next';
import { MEDIA_KINDS, type MediaKind, type SearchResult } from '@trackt/shared';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cover } from '../../../src/components/Cover';
import { FilterBar, type MenuRow } from '../../../src/components/FilterBar';
import { KindDot } from '../../../src/components/KindDot';
import {
  EmptyState,
  Loading,
  PageFrame,
  PageTitle,
  useTabContentInset,
} from '../../../src/components/Page';
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
 * `GET /search?q=&kind=`.
 *
 * The 250 ms debounce is not a nicety: the endpoint's rate bucket is 60/min, and
 * an unthrottled `onChangeText` spends that in four seconds of typing. Web gets
 * its debounce from the URL `?q=` sync; there is no URL here, so `useDebounced`
 * is the one that does it.
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
  const debounced = useDebounced(query, 250);
  const { status, results } = useMediaSearch(debounced, kind);
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const kindRows: MenuRow[] = [
    { key: 'all', label: t('news.allKinds'), selected: kind === undefined },
    ...MEDIA_KINDS.map((value) => ({
      key: value,
      label: labels.kind(value),
      selected: kind === value,
    })),
  ];

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

  return (
    <PageFrame fadeOnFocus>
      <View style={{ paddingTop: insets.top + space.lg }}>
        <View style={gutter}>
          <PageTitle
            title={t('discover.title')}
            count={
              status === 'success'
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
            filters={[
              {
                key: 'kind',
                icon: 'list',
                label: kind ? labels.kind(kind) : t('news.allKinds'),
                rows: kindRows,
                onSelect: (key) => setKind(key === 'all' ? undefined : (key as MediaKind)),
              },
            ]}
          />
        </View>
      </View>

      {status === 'idle' ? (
        <View style={gutter}>
          <EmptyState title={t('discover.title')} body={t('discover.emptyInitial')} />
        </View>
      ) : status === 'error' ? (
        <View style={gutter}>
          <EmptyState title={t('errors.searchFailed')} body={t('errors.searchFailed')} />
        </View>
      ) : status === 'loading' && results.length === 0 ? (
        <Loading />
      ) : results.length === 0 ? (
        <View style={gutter}>
          <EmptyState
            title={t('common.unknown')}
            body={
              kind
                ? t('discover.emptyInKind', {
                    query: debounced,
                    kind: labels.kind(kind).toLowerCase(),
                  })
                : t('discover.empty', { query: debounced })
            }
          />
        </View>
      ) : (
        <FlashList
          data={results}
          numColumns={COLUMNS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: bottomInset }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ResultTile result={item} width={columnWidth} />}
        />
      )}
    </PageFrame>
  );
}

function ResultTile({ result, width }: { result: SearchResult; width: number }) {
  return (
    <Touchable href={`/media/${result.slug}`} style={styles.tile}>
      <Cover kind={result.kind} title={result.title} coverUrl={result.coverUrl} width={width} />
      <Text style={[type.bodySm, styles.tileTitle]} numberOfLines={2}>
        {result.title}
      </Text>
      <View style={styles.metaRow}>
        <KindDot kind={result.kind} />
        <Text style={[type.eyebrow, text.dim]} numberOfLines={1}>
          {result.seasonNumber ? `S${result.seasonNumber}` : (result.year ?? '—')}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  filters: {
    marginVertical: space.md,
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
  tile: {
    marginBottom: space.lg,
    marginRight: space.md,
    gap: space.xs,
  },
  tileTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
