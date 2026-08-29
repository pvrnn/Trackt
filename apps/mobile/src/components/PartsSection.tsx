import { firstUnwatched, partWindow } from '@trackt/client';
import type { partBlocks } from '@trackt/client';
import type { MediaDetail } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { SectionTitle } from './Page';
import { PartBlockRow, PartRow } from './PartRows';
import { gutter, layout, space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** 'Episode'/'Chapter', its plural, and the short prefix a button uses. */
export function partNoun(detail: MediaDetail): {
  singular: string;
  plural: string;
  prefix: string;
} {
  return detail.kind === 'manga' || detail.kind === 'webtoon'
    ? { singular: 'Chapter', plural: 'Chapters', prefix: 'CH' }
    : { singular: 'Episode', plural: 'Episodes', prefix: 'E' };
}

/**
 * The parts, at whatever scale the work is.
 *
 * Short work: every part, as a row. Long work: blocks of forty, and a six-row
 * window inside the one you open — the design's "never the whole volume, never
 * the whole work". An unknown count (an airing season) has no scale to block
 * up, so it gets the window around the position and nothing else.
 *
 * Every row writes the position: tapping part 140 marks everything to it,
 * tapping a part already done sets the position to one below, which is how an
 * overshoot is corrected without a dialog.
 */
export function PartsSection({
  detail,
  noun,
  total,
  position,
  watched,
  blocks,
  openBlock,
  onToggleBlock,
  onSetPosition,
}: {
  detail: MediaDetail;
  noun: { singular: string; plural: string; prefix: string };
  total: number | null;
  position: number;
  watched: ReadonlySet<number>;
  blocks: ReturnType<typeof partBlocks>;
  openBlock: number | null;
  onToggleBlock: (index: number) => void;
  onSetPosition: (upTo: number) => void;
}) {
  const volumes = detail.kind === 'manga' || detail.kind === 'webtoon';
  const next = firstUnwatched(watched, total ?? position + 1);

  const row = (number: number) => (
    <PartRow
      key={number}
      label={`${noun.singular} ${number}`}
      done={watched.has(number)}
      isNext={number === next}
      // Tapping what you have done sets the position below it; tapping ahead
      // brings everything up to it. One write either way.
      onPress={() => onSetPosition(watched.has(number) ? number - 1 : number)}
    />
  );

  if (total === null) {
    // No count yet: no blocks, no percentage — just where you are and what is
    // immediately around it.
    const around = partWindow(1, position + 4, position);
    return (
      <View style={[gutter, styles.parts]}>
        <SectionTitle title={noun.plural} />
        <Text style={[type.eyebrow, text.dim]}>{position} SO FAR · COUNT NOT PUBLISHED YET</Text>
        <View style={styles.rows}>{around.map(row)}</View>
      </View>
    );
  }

  if (blocks.length === 0) {
    return (
      <View style={[gutter, styles.parts]}>
        <SectionTitle title={noun.plural} />
        <View style={styles.rows}>{Array.from({ length: total }, (_, i) => i + 1).map(row)}</View>
      </View>
    );
  }

  // The block you are in is the one that opens, until you say otherwise.
  const current = Math.min(
    blocks.length,
    Math.max(1, Math.ceil(Math.max(position, 1) / blocks[0]!.size)),
  );
  const activeIndex = openBlock ?? current;
  const active = blocks.find((block) => block.index === activeIndex) ?? blocks[0]!;
  const window = partWindow(active.from, active.to, position);
  const inside = position >= active.from && position <= active.to;

  return (
    <View style={[gutter, styles.parts]}>
      <View style={styles.partsHead}>
        <SectionTitle title={volumes ? 'Volumes' : noun.plural} />
        <Text style={[type.eyebrow, text.dim]}>
          {blocks.length} {volumes ? 'VOLUMES' : 'BLOCKS'} · {total} {noun.plural.toUpperCase()}
        </Text>
      </View>

      <View style={styles.rows}>
        {blocks.map((block) => (
          <PartBlockRow
            key={block.index}
            block={block}
            label={volumes ? `Volume ${block.index}` : `${noun.plural} ${block.from}–${block.to}`}
            rangeLabel={
              volumes
                ? `${noun.prefix} ${block.from}–${block.to}`
                : `${block.size} ${noun.plural.toUpperCase()}`
            }
            open={block.index === activeIndex}
            onPress={() => onToggleBlock(block.index)}
          />
        ))}
      </View>

      <View style={styles.windowHead}>
        <Text style={[type.section, text.fg]}>
          {(volumes
            ? `Volume ${active.index}`
            : `${noun.plural} ${active.from}–${active.to}`
          ).toUpperCase()}
          {inside ? ' · AROUND YOU' : ''}
        </Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.rows}>{window.map(row)}</View>
      <Text style={[type.eyebrow, text.faint]}>
        OPEN A {volumes ? 'VOLUME' : 'BLOCK'} TO JUMP THERE · THE SLIDER TRAVELS FURTHER
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  parts: {
    gap: space.md,
    marginTop: layout.sectionGap,
  },
  partsHead: {
    gap: space.xs,
  },
  rows: {
    gap: space.sm,
  },
  windowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: surface.glassBorder,
  },
});
