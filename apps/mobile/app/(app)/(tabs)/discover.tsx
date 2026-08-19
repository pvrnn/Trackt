import { FlashList } from '@shopify/flash-list';
import { KIND_LABELS, useDebounced, useMediaSearch } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind, type SearchResult } from '@trackt/shared';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, ChipRow } from '../../../src/components/Chip';
import { Cover } from '../../../src/components/Cover';
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
import { color, layout, radius, space, surface } from '../../../src/theme/tokens';
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
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MediaKind | undefined>(undefined);
  const debounced = useDebounced(query, 250);
  const { status, results } = useMediaSearch(debounced, kind);
  const bottomInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

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
        <View style={styles.gutter}>
          <PageTitle
            title="Discover"
            count={
              status === 'success'
                ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
                : undefined
            }
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search this instance…"
            placeholderTextColor={color.faint}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search titles"
            style={[type.body, styles.input]}
          />
        </View>
        <View style={styles.chips}>
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
        </View>
      </View>

      {status === 'idle' ? (
        <View style={styles.gutter}>
          <EmptyState
            title="Search the catalog"
            body="Type a title to find it. The kind chips narrow the results as you go."
          />
        </View>
      ) : status === 'error' ? (
        <View style={styles.gutter}>
          <EmptyState title="Search failed" body="The instance didn't answer. Try again." />
        </View>
      ) : status === 'loading' && results.length === 0 ? (
        <Loading />
      ) : results.length === 0 ? (
        <View style={styles.gutter}>
          <EmptyState
            title="Nothing found"
            body={`No ${kind ? KIND_LABELS[kind].toLowerCase() : 'titles'} match “${debounced}” on this instance.`}
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
        <Text style={[type.eyebrow, styles.dim]} numberOfLines={1}>
          {result.seasonNumber ? `S${result.seasonNumber}` : (result.year ?? '—')}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: layout.gutter,
  },
  chips: {
    // The row scrolls edge to edge, so its own padding supplies the gutter.
    marginVertical: space.md,
  },
  input: {
    minHeight: layout.touchTarget,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: surface.glassWell,
    borderWidth: StyleSheet.hairlineWidth,
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
  dim: {
    color: color.dim,
  },
});
