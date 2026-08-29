import { ScrollView, StyleSheet, Text } from 'react-native';
import type { ReactNode } from 'react';
import type { Href } from 'expo-router';
import type { MediaKind } from '@trackt/shared';
import { Cover } from './Cover';
import { Touchable } from './Touchable';
import { layout, space, text } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The horizontal row of covers — favourites, in progress, related works.
 *
 * `padding` is how the row meets the screen edge: `gutter` for a shelf that
 * scrolls out of a gutter-less parent, `right` for one already inside the
 * gutter that should still run off it, `none` inside an already-padded parent.
 */
export function Shelf({
  children,
  padding = 'none',
}: {
  children: ReactNode;
  padding?: 'gutter' | 'right' | 'none';
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.shelf, PADDING[padding]]}
    >
      {children}
    </ScrollView>
  );
}

/**
 * One cover in a shelf. `overlay` paints on the cover (the favourites rank),
 * `children` sits between cover and caption (the relation eyebrow), and `note`
 * goes under it (the progress count).
 */
export function ShelfItem({
  href,
  kind,
  title,
  coverUrl,
  width = 96,
  progress,
  caption = true,
  captionLines = 1,
  coverTitle = true,
  note,
  overlay,
  children,
  accessibilityLabel,
}: {
  href: Href;
  kind: MediaKind;
  title: string;
  coverUrl: string | null;
  width?: number;
  /** 0–1, drawn as the bar along the cover's bottom edge. */
  progress?: number | undefined;
  /** The title under the cover. Off where the rank badge says everything. */
  caption?: boolean;
  captionLines?: number;
  /** The title drawn *on* a generated cover; see `Cover`. */
  coverTitle?: boolean;
  note?: string | undefined;
  overlay?: ReactNode;
  children?: ReactNode;
  accessibilityLabel?: string | undefined;
}) {
  return (
    <Touchable href={href} {...(accessibilityLabel ? { accessibilityLabel } : {})}>
      <Cover
        kind={kind}
        title={title}
        coverUrl={coverUrl}
        width={width}
        showTitle={coverTitle}
        {...(progress !== undefined ? { progress } : {})}
      />
      {overlay}
      {children}
      {caption ? (
        <Text
          style={[type.bodySm, text.fg, styles.caption, { width }]}
          numberOfLines={captionLines}
        >
          {title}
        </Text>
      ) : null}
      {note ? <Text style={[type.eyebrow, text.dim]}>{note}</Text> : null}
    </Touchable>
  );
}

const PADDING = StyleSheet.create({
  gutter: { paddingHorizontal: layout.gutter },
  right: { paddingRight: layout.gutter },
  none: {},
});

const styles = StyleSheet.create({
  shelf: {
    gap: space.md,
  },
  caption: {
    marginTop: space.sm,
  },
});
