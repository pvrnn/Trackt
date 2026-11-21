import { dayNumber, formatScore, shortDate, todayIso } from '@trackt/client';
import type { HistoryEntry, LogStatus } from '@trackt/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { intlLocale } from '../i18n';
import { useLabels } from '../lib/labels';
import { color, layout, radius, space, stroke, surface } from '../theme/tokens';
import { font, type } from '../theme/typography';
import { Cover } from './Cover';
import { KindDot } from './KindDot';
import { PrismText } from './PrismText';
import { Touchable } from './Touchable';

/** Pink is the one live state; paused keeps the warm gold, dropped recedes. */
const STATUS_COLORS: Record<LogStatus, string> = {
  planned: color.dim,
  in_progress: color.pink,
  completed: color.muted,
  paused: color.gold,
  dropped: color.dim,
};

const COVER_WIDTH = 40;

/**
 * One history row (`Mobile App.dc.html`, HISTORY): the cover beside, never
 * under, the words — title, kind and status, the dated span, the score. What
 * the desktop timeline keeps in a hover is all written out.
 */
export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { t, i18n } = useTranslation();
  const labels = useLabels();
  const loc = intlLocale(i18n.language);
  const filed = entry.loggedOn.slice(0, 4);
  // The year only when it is not the one the row is filed under.
  const date = (iso: string) =>
    iso.slice(0, 4) === filed ? shortDate(iso, loc) : `${shortDate(iso, loc)} ${iso.slice(0, 4)}`;
  const days = (from: string, to: string) =>
    t('history.timeline.days', { count: dayNumber(to) - dayNumber(from) + 1 });

  const range = (() => {
    const s = entry.startedAt;
    const f = entry.finishedAt;
    if (s !== null && f === null && entry.status === 'in_progress') {
      return `${t('history.row.since', { date: date(s) })} · ${days(s, todayIso())}`;
    }
    if (s === null && f === null) return null;
    if (s === null) return t('date.until', { date: date(f!) });
    if (f === null) return t('date.from', { date: date(s) });
    if (s === f) return date(s);
    return `${date(s)} → ${date(f)} · ${days(s, f)}`;
  })();

  return (
    <Touchable href={`/media/${entry.slug}`} style={styles.row}>
      <Cover
        kind={entry.kind}
        title={entry.title}
        coverUrl={entry.coverUrl}
        width={COVER_WIDTH}
        showTitle={false}
        style={styles.cover}
      />
      <View style={styles.body}>
        <Text style={[type.cardTitle, styles.title]} numberOfLines={1}>
          {entry.title}
        </Text>
        <View style={styles.meta}>
          <KindDot kind={entry.kind} />
          <Text style={[styles.label, styles.kind]} numberOfLines={1}>
            {labels.kindSingular(entry.kind).toLocaleUpperCase(loc)}
          </Text>
          <Text style={[styles.label, { color: STATUS_COLORS[entry.status] }]} numberOfLines={1}>
            · {labels.status(entry.status).toLocaleUpperCase(loc)}
          </Text>
        </View>
        {range ? (
          <Text style={[styles.label, styles.range]} numberOfLines={1}>
            {range}
          </Text>
        ) : null}
      </View>
      {entry.score !== null ? (
        <Text style={styles.score}>{formatScore(entry.score, loc)}</Text>
      ) : null}
    </Touchable>
  );
}

/** The four totals as one ruled strip, sharing the filter slab's surface. */
export function HistoryStrip({ stats }: { stats: { value: number; label: string }[] }) {
  return (
    <View style={styles.strip}>
      {stats.map((stat, i) => (
        <View key={stat.label} style={[styles.stat, i > 0 ? styles.statRule : null]}>
          <PrismText style={styles.statValue}>{String(stat.value)}</PrismText>
          <Text style={[type.tabLabel, styles.statLabel]} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
    paddingVertical: 10,
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  cover: {
    borderRadius: radius.thumb,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: space.xs,
  },
  title: {
    color: color.fg,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  kind: {
    color: color.muted,
  },
  range: {
    color: color.dim,
  },
  score: {
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: 24,
    color: color.pink,
  },
  strip: {
    flexDirection: 'row',
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
    paddingVertical: space.md,
    paddingHorizontal: 6,
  },
  statRule: {
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 22,
    lineHeight: 24,
  },
  statLabel: {
    color: color.dim,
    textAlign: 'center',
  },
});
