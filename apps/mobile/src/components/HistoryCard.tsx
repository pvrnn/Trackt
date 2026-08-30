import { LOG_STATUS_LABELS, dateRangeLabel } from '@trackt/client';
import type { HistoryEntry, LogStatus } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Cover } from './Cover';
import { GlassCard } from './GlassCard';
import { KindDot } from './KindDot';
import { PrismText } from './PrismText';
import { Touchable } from './Touchable';
import { color, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * Per-status colour, from `docs/design/History.dc.html`: in-progress is the live
 * pink, paused the warm gold, completed a settled neutral, dropped recedes.
 */
const STATUS_COLORS: Record<LogStatus, string> = {
  planned: color.dim,
  in_progress: color.pink,
  completed: color.fg,
  paused: color.gold,
  dropped: color.faint,
};

/**
 * One self-contained poster card. Nothing legibility-critical sits on raw
 * artwork (design brief): the status and score ride opaque chips, and the title
 * plate below the cover is solid `#12101A`, so a white poster and a black one
 * read identically.
 */
export function EntryCard({ entry, width }: { entry: HistoryEntry; width: number }) {
  const range = dateRangeLabel(entry.startedAt, entry.finishedAt);
  return (
    <Touchable href={`/media/${entry.slug}`} style={[{ width }, styles.card]}>
      <View>
        <Cover kind={entry.kind} title={entry.title} coverUrl={entry.coverUrl} width={width} />
        <View style={styles.pills}>
          <Text style={[type.eyebrow, styles.pill, { color: STATUS_COLORS[entry.status] }]}>
            {LOG_STATUS_LABELS[entry.status]}
          </Text>
          {entry.score !== null ? (
            <Text style={[type.eyebrow, styles.pill, styles.score]}>{entry.score}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.plate}>
        <Text style={[type.cardTitle, styles.plateTitle]} numberOfLines={2}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          <KindDot kind={entry.kind} />
          <Text style={[type.eyebrow, text.dim]} numberOfLines={1}>
            {range ?? '—'}
          </Text>
        </View>
        {/* `24 / 24` on a finished title is noise, so progress shows only
              while there is progress left to make. */}
        {entry.status !== 'completed' && entry.total ? (
          <Text style={[type.eyebrow, text.dim]}>
            {entry.watched} / {entry.total}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

export function Total({ value, label, scope }: { value: number; label: string; scope: string }) {
  return (
    <GlassCard style={styles.total}>
      <View style={styles.shrink}>
        <PrismText style={type.stat}>{String(value)}</PrismText>
      </View>
      <View>
        <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
        <Text style={[type.eyebrow, text.faint]}>{scope}</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.cover,
    overflow: 'hidden',
    backgroundColor: '#12101a',
  },
  pills: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  pill: {
    backgroundColor: 'rgba(14,12,16,0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  score: {
    color: color.pink,
  },
  plate: {
    borderTopWidth: stroke,
    borderTopColor: surface.glassBorder,
    padding: space.md,
    gap: space.xs,
  },
  plateTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  total: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  shrink: {
    alignSelf: 'flex-start',
  },
});
