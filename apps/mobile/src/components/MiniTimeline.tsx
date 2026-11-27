import { formatScore, layoutTimeline, todayIso, useHistory } from '@trackt/client';
import type { HistoryFilters, TimelineItem } from '@trackt/client';
import type { HistoryEntry } from '@trackt/shared';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { intlLocale } from '../i18n';
import { useLabels } from '../lib/labels';
import {
  PRISM,
  color,
  layout,
  nativeSurface,
  radius,
  space,
  stroke,
  surface,
} from '../theme/tokens';
import { font } from '../theme/typography';
import { Icon } from './Icon';
import { KIND_COLORS } from './KindDot';
import { AnimatedPressable, ripple, usePressMotion } from './Press';

/**
 * The mini arrow of time (`docs/design/Timeline.dc.html`, `mini`): every title a
 * bar from start to finish above one axis you swipe sideways, packed by the
 * shared `layoutTimeline`. Used by History and the Profile.
 */

const PX_PER_DAY = 3.4;
const PAD_START = 48;
const PAD_END = 110;
const LANE = 36;
const BAR = 10;
const GAP = 4;
const BAND = 28;
const SHAFT = 5;
const HEAD_L = 16;
const HEAD_H = 10;
const TODAY_DOT = 13;
const PAD_Y = 12;
/** A step through time is three quarters of what is on screen, as on web. */
const STEP = 0.75;

const PRISM_RGB = [
  [217, 164, 65],
  [217, 107, 176],
  [139, 92, 246],
] as const;

function prismAt(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  const seg = f < 0.5 ? 0 : 1;
  const u = seg === 0 ? f / 0.5 : (f - 0.5) / 0.5;
  const from = PRISM_RGB[seg]!;
  const to = PRISM_RGB[seg + 1]!;
  return `rgb(${from.map((value, i) => Math.round(value + (to[i]! - value) * u)).join(',')})`;
}

/** The API's largest page: the timeline wants every title, in as few trips as possible. */
const TIMELINE_PAGE = 200;

/**
 * Every page of a history, all time. The axis starts at the oldest title, so
 * the timeline waits for the last page rather than redrawing (and jumping its
 * scroll) as each older one lands.
 */
export function useTimelineHistory(filters: Omit<HistoryFilters, 'year' | 'limit'>) {
  const history = useHistory({ ...filters, limit: TIMELINE_PAGE });
  const { hasMore, isLoadingMore, loadMore } = history;
  useEffect(() => {
    if (hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);
  return {
    entries: history.entries,
    isError: history.isError,
    ready: !history.isLoading && !history.hasMore,
  };
}

export function MiniTimeline({
  entries,
  jumpYear = 'all',
}: {
  entries: HistoryEntry[];
  /** The year picked above: the timeline scrolls there rather than filtering to it. */
  jumpYear?: number | 'all';
}) {
  const { t, i18n } = useTranslation();
  const labels = useLabels();
  const locale = intlLocale(i18n.language);
  const reduced = useReducedMotion();
  const scroller = useRef<ScrollViewInstance>(null);
  const [viewport, setViewport] = useState(0);
  const offset = useRef(0);
  const [edge, setEdge] = useState<'start' | 'end' | null>('end');
  const today = todayIso();

  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
    [locale],
  );
  const caps = (value: string) => value.replace(/\./g, '').toLocaleUpperCase(locale);
  const short = (iso: string) => caps(dateFormat.format(new Date(`${iso}T00:00:00Z`)));

  const tagOf = (entry: HistoryEntry): string | null =>
    entry.status === 'paused' || entry.status === 'dropped'
      ? caps(labels.status(entry.status))
      : entry.score !== null
        ? formatScore(entry.score, locale)
        : null;

  const metaOf = (item: TimelineItem) =>
    item.single
      ? short(item.start)
      : `${short(item.start)} → ${item.ongoing ? t('history.timeline.todayMark') : short(item.end)} · ${t('history.timeline.days', { count: item.days })}`;

  const timeline = layoutTimeline(entries, {
    today,
    pxPerDay: PX_PER_DAY,
    padStart: PAD_START,
    padEnd: PAD_END,
    // A character-count estimate, as the design does; the label is clipped to it.
    labelWidth: (entry) => {
      const tag = tagOf(entry);
      return (entry.title.length + (tag ? tag.length + 1 : 0)) * 6.4 + 14;
    },
  });

  const axisY = timeline.lanes * LANE + 6;
  const height = axisY + BAND;
  const year = Number(today.slice(0, 4));
  const tipDay = (timeline.width - HEAD_L - timeline.xOfYear(year)) / PX_PER_DAY;
  const daysInYear = (timeline.xOfYear(year + 1) - timeline.xOfYear(year)) / PX_PER_DAY;
  const tipColor = prismAt(tipDay / daysInYear);
  const maxOffset = Math.max(0, timeline.width - viewport);

  const target =
    jumpYear === 'all' || jumpYear >= year
      ? maxOffset
      : Math.min(maxOffset, Math.max(0, timeline.xOfYear(jumpYear) - 24));

  const measured = viewport > 0;
  const edgeOf = (x: number) => (x <= 1 ? 'start' : x >= maxOffset - 1 ? 'end' : null);

  // Opening, picking the current year and a filter changing the span land on
  // today; another year lands on its 1 January.
  useEffect(() => {
    if (!measured) return;
    scroller.current?.scrollTo({ x: target, animated: false });
    offset.current = target;
    // Deliberately not on `target`: a scroll by hand must not snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpYear, measured, timeline.width]);

  const step = (direction: 1 | -1) => {
    const x = Math.min(maxOffset, Math.max(0, offset.current + direction * viewport * STEP));
    scroller.current?.scrollTo({ x, animated: !reduced });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    offset.current = x;
    const next = edgeOf(x);
    if (next !== edge) setEdge(next);
  };

  return (
    <View style={styles.frame}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t('history.timeline.region')}
        onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.content}
      >
        <View style={{ width: timeline.width, height }}>
          {timeline.ticks.map((tick) => {
            const january = tick.month === 0;
            const label = january
              ? String(tick.year)
              : tick.month % 3 === 0
                ? caps(monthFormat.format(new Date(Date.UTC(tick.year, tick.month, 1))))
                : '';
            return (
              <Fragment key={`${tick.year}-${tick.month}`}>
                <View
                  style={[
                    styles.rule,
                    {
                      left: tick.x,
                      backgroundColor: january ? surface.glassBorderStrong : surface.glass,
                    },
                  ]}
                />
                {label ? (
                  <Text
                    style={[
                      styles.tick,
                      { left: tick.x, top: axisY + 10 },
                      january ? styles.fg : null,
                    ]}
                  >
                    {label}
                  </Text>
                ) : null}
              </Fragment>
            );
          })}

          <View
            style={[
              styles.shaft,
              { top: axisY - SHAFT / 2, width: timeline.width - HEAD_L, height: SHAFT },
            ]}
          >
            {timeline.years.map((band) => (
              <LinearGradient
                key={band.year}
                colors={[...PRISM]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.band, { left: band.x, width: band.width }]}
              />
            ))}
          </View>
          <View
            style={[
              styles.head,
              {
                left: timeline.width - HEAD_L - 1,
                top: axisY - HEAD_H,
                borderLeftWidth: HEAD_L,
                borderTopWidth: HEAD_H,
                borderBottomWidth: HEAD_H,
                borderLeftColor: tipColor,
              },
            ]}
          />
          <View
            style={[
              styles.todayDot,
              { left: timeline.todayX - TODAY_DOT / 2, top: axisY - TODAY_DOT / 2 },
            ]}
          />
          <Text style={[styles.tick, styles.fg, { left: timeline.todayX + 6, top: axisY + 10 }]}>
            {t('history.timeline.todayMark')}
          </Text>

          {timeline.items.map((item) => (
            <TimelineBar
              key={item.entry.id}
              item={item}
              top={axisY - 10 - (item.lane + 1) * LANE + 8}
              tag={tagOf(item.entry)}
              accessibilityLabel={`${item.entry.title} · ${metaOf(item)}`}
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.steps}>
        <StepButton
          icon="chevron-left"
          label={t('history.timeline.earlier')}
          disabled={edge === 'start' || maxOffset === 0}
          onPress={() => step(-1)}
        />
        <StepButton
          icon="chevron-right"
          label={t('history.timeline.later')}
          disabled={edge === 'end' || maxOffset === 0}
          onPress={() => step(1)}
        />
      </View>
    </View>
  );
}

function TimelineBar({
  item,
  top,
  tag,
  accessibilityLabel,
}: {
  item: TimelineItem;
  top: number;
  tag: string | null;
  accessibilityLabel: string;
}) {
  const router = useRouter();
  const press = usePressMotion();
  const { entry } = item;
  const tint = KIND_COLORS[entry.kind];
  const tagColor =
    entry.status === 'paused' ? color.gold : entry.status === 'dropped' ? color.dim : color.pink;
  return (
    <AnimatedPressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => router.push(`/media/${entry.slug}`)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      // Out to the lane pitch and no further, so neighbouring lanes never steal a tap.
      hitSlop={{ top: 4, bottom: 4 }}
      style={[styles.item, { left: item.x, top, width: item.width }, press.animatedStyle]}
    >
      <Text numberOfLines={1} style={styles.title}>
        {entry.title}
        {tag ? <Text style={[styles.tag, { color: tagColor }]}> {tag}</Text> : null}
      </Text>
      <View style={styles.bar}>
        {!item.single ? (
          <Svg width={item.barWidth} height={2} style={styles.thread}>
            <Line
              x1={0}
              y1={1}
              x2={item.barWidth}
              y2={1}
              stroke={tint}
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          </Svg>
        ) : null}
        {item.segments.map((segment) => (
          <View
            key={segment.x}
            style={[
              styles.segment,
              {
                left: segment.x,
                width: Math.max(segment.width, 4),
                backgroundColor: tint,
                opacity: entry.status === 'dropped' ? 0.5 : 1,
              },
            ]}
          />
        ))}
        {item.single ? <View style={[styles.diamond, { backgroundColor: tint }]} /> : null}
        {item.ongoing ? (
          <View style={[styles.ring, { left: item.barWidth - 6, borderColor: tint }]} />
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

/** A 28pt disc in a 44pt target, clear of the arrow in the corner. */
function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-left' | 'chevron-right';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const press = usePressMotion();
  const slop = (layout.touchTarget - 28) / 2;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={slop}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple(true)}
      style={[styles.stepButton, disabled ? styles.stepDisabled : null, press.animatedStyle]}
    >
      <Icon name={icon} color={disabled ? color.faint : color.fg} size={14} />
    </AnimatedPressable>
  );
}

const DIAMOND = BAR - 1;

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
    overflow: 'hidden',
  },
  content: {
    paddingVertical: PAD_Y,
  },
  rule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: stroke,
  },
  tick: {
    position: 'absolute',
    paddingLeft: 6,
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.dim,
    includeFontPadding: false,
  },
  fg: {
    color: color.fg,
  },
  shaft: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  head: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  todayDot: {
    position: 'absolute',
    width: TODAY_DOT,
    height: TODAY_DOT,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: color.fg,
    backgroundColor: color.ink,
  },
  item: {
    position: 'absolute',
    height: LANE - 8,
    justifyContent: 'flex-end',
    gap: GAP,
  },
  title: {
    paddingRight: space.sm,
    fontFamily: font.bodySemibold,
    fontSize: 11,
    lineHeight: 13,
    color: color.fg,
  },
  tag: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  bar: {
    height: BAR,
    width: '100%',
  },
  thread: {
    position: 'absolute',
    left: 0,
    top: BAR / 2 - 1,
  },
  segment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  diamond: {
    position: 'absolute',
    left: 1,
    top: (BAR - DIAMOND) / 2,
    width: DIAMOND,
    height: DIAMOND,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  ring: {
    position: 'absolute',
    top: BAR / 2 - 6,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 3,
    backgroundColor: '#17131d',
  },
  steps: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    flexDirection: 'row',
    gap: space.xs,
  },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: nativeSurface.sheet,
  },
  stepDisabled: {
    opacity: 0.5,
  },
});
