import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLabels } from '../lib/labels';
import { color, radius, stroke, surface } from '../theme/tokens';
import { font } from '../theme/typography';
import { KIND_COLORS } from './KindDot';

/**
 * The glass filter slab Discover and News share (`Mobile App.dc.html`): one
 * panel whose rows are split by hairlines, so no dropdown floats loose.
 */
export function FilterSlab({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.slab, style]}>{children}</View>;
}

/** A slab row under the one above it. `row` lays its children side by side. */
export function SlabRow({ children, row = false }: { children: ReactNode; row?: boolean }) {
  return <View style={[styles.rule, row && styles.row]}>{children}</View>;
}

/** Lets a cell in a `row` SlabRow share the line with the cells beside it. */
export function SlabCell({ children }: { children: ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}

/** A read-only figure at the end of a `row` SlabRow: how many items the filters leave. */
export function SlabNote({ children }: { children: string }) {
  return (
    <View style={styles.note}>
      <Text numberOfLines={1} style={styles.noteText}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * The kind dock (`Mobile App.dc.html`): all seven choices at once,
 * named, one tap each and no sideways scroll; there is no hover on a phone, so
 * the names stay visible. A hollow ring is every kind, a dot each kind, and the
 * picked one wears a ring. Picking the picked kind again goes back to all.
 */
export function KindDock({
  kind,
  onKind,
  counts,
  first = false,
}: {
  kind: MediaKind | undefined;
  onKind: (kind: MediaKind | undefined) => void;
  /** Hits per kind for the other filters; a kind with none dims. Absent while browsing. */
  counts?: Partial<Record<MediaKind, number>> | undefined;
  /** The slab's opening row, with no rule above it. */
  first?: boolean;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const options: (MediaKind | undefined)[] = [undefined, ...MEDIA_KINDS];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('discover.filterAria')}
      style={[!first && styles.rule, styles.dock]}
    >
      {options.map((option) => {
        const on = option === kind;
        const name = option ? labels.kindSingular(option).toUpperCase() : t('common.all');
        const count = counts
          ? option
            ? (counts[option] ?? 0)
            : MEDIA_KINDS.reduce((sum, value) => sum + (counts[value] ?? 0), 0)
          : undefined;
        const tint = option ? KIND_COLORS[option] : color.fg;
        return (
          <Pressable
            key={option ?? 'all'}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={count === undefined ? name : `${name} · ${count}`}
            onPress={() => onKind(on || !option ? undefined : option)}
            style={({ pressed }) => [
              styles.dockItem,
              pressed && styles.dockPressed,
              { opacity: option && count === 0 && !on ? 0.35 : 1 },
            ]}
          >
            <View style={[styles.dockRing, on && { borderColor: tint }]}>
              <View
                style={[
                  styles.dockDot,
                  option
                    ? { backgroundColor: tint }
                    : { borderWidth: 1.5, borderColor: on ? color.fg : color.muted },
                ]}
              />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.dockLabel, { color: on ? color.fg : color.dim }]}
            >
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  slab: {
    borderRadius: radius.card,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
    overflow: 'hidden',
  },
  rule: {
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  note: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  noteText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
    color: color.dim,
  },
  dock: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dockItem: {
    flex: 1,
    minWidth: 0,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 10,
  },
  dockPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dockRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dockLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: 0.36,
  },
});
