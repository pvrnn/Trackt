import type { MediaKind } from '@trackt/shared';
import { StyleSheet, View } from 'react-native';
import { color } from '../theme/tokens';

/** Per-kind dot colours, straight from the design tokens. */
export const KIND_COLORS: Record<MediaKind, string> = {
  movie: color.kindMovie,
  series: color.kindSeries,
  anime: color.kindAnime,
  manga: color.kindManga,
  webtoon: color.kindWebtoon,
};

/**
 * The 6pt kind dot that prefixes every meta line, ported from web's `KindDot`.
 * Decorative: the kind is always spelled out in the text beside it, so the dot
 * is hidden from the accessibility tree rather than labelled twice.
 */
export function KindDot({ kind, size = 6 }: { kind: MediaKind; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.dot, { width: size, height: size, backgroundColor: KIND_COLORS[kind] }]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 999,
  },
});
