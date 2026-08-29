import { KIND_LABELS_SINGULAR, coverGradientStops } from '@trackt/client';
import type { MediaDetail } from '@trackt/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { color, layout, radius, space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';
import { KIND_COLORS } from './KindDot';

/** The full-bleed panel the media screen opens on (`Mobile Media.dc.html`). */
export const HERO_HEIGHT = 340;

/**
 * The hero: the artwork *is* the header.
 *
 * The mockup replaces the old cover-beside-text row with a full-bleed panel —
 * the art (or, with no artwork, the title's own deterministic gradient) run to
 * all four edges, scrimmed top and bottom so a floating back pill stays legible
 * over anything and the title has ink to sit on. Nothing about the layout
 * depends on having a cover, which matters because most catalog rows do not.
 *
 * Everything in the bottom block is *identifying*: kind, year, genres, title,
 * and the state of the viewer's log. The things you can do are below it.
 * The two chips are live: status opens the log sheet, the date range opens the
 * date sheet — the same two sheets the old pill row opened, minus the row.
 *
 * The panel parallaxes at a third of the scroll and dims as the header bar
 * takes over, so the two halves of the header hand off instead of both being on
 * screen at once. Pulling *down* scales it rather than leaving a gap.
 */
export function MediaHero({
  media,
  scrollY,
  statusLabel,
  dateLabel,
  onEditStatus,
  onEditDates,
}: {
  media: MediaDetail;
  scrollY: SharedValue<number>;
  /** 'READING' / 'IN PROGRESS' / null when nothing is logged. */
  statusLabel: string | null;
  /** 'FROM 02 FEB', or null when the log carries no dates. */
  dateLabel: string | null;
  onEditStatus: () => void;
  onEditDates: () => void;
}) {
  const [from, to] = coverGradientStops(media.kind, media.title);
  // A bare count says nothing: "ENDED · 7" is seven of what?
  const unit = media.kind === 'manga' || media.kind === 'webtoon' ? 'CHAPTERS' : 'EPISODES';

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [0, 300], [0, 100], 'clamp') },
      { scale: scrollY.value < 0 ? 1 + Math.min(-scrollY.value, 160) / 600 : 1 },
    ],
  }));

  const meta = [
    KIND_LABELS_SINGULAR[media.kind].toUpperCase(),
    media.year ? String(media.year) : null,
    media.seasonNumber ? `S${media.seasonNumber}` : null,
    media.genres.length > 0 ? media.genres.slice(0, 2).join(', ').toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.hero}>
      <Animated.View style={[StyleSheet.absoluteFill, panelStyle]}>
        <LinearGradient
          colors={[from, to]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {media.coverUrl ? (
          <Image
            source={{ uri: media.coverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {/* Two scrims, not one: the top protects the back pill and the status
            bar, the bottom carries the panel into the page's own ink so there
            is no seam where the hero ends. */}
        <LinearGradient
          colors={['rgba(14,12,16,0.72)', 'transparent']}
          locations={[0, 0.26]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['transparent', 'rgba(14,12,16,0.88)', color.ink]}
          locations={[0.4, 0.76, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.bottom}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: KIND_COLORS[media.kind] }]} />
          <Text style={[type.eyebrow, text.muted]} numberOfLines={1}>
            {meta}
          </Text>
        </View>

        <Text style={styles.title}>{media.title.toUpperCase()}</Text>

        <View style={styles.chips}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              statusLabel ? `Status: ${statusLabel.toLowerCase()}. Change it` : 'Add to your log'
            }
            onPress={onEditStatus}
            style={({ pressed }) => [
              styles.chip,
              statusLabel ? styles.chipPink : styles.chipGlass,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            {statusLabel ? <View style={styles.chipDot} /> : null}
            <Text style={[type.eyebrow, statusLabel ? text.pink : text.fg]}>
              {statusLabel ?? 'ADD TO LOG'}
            </Text>
          </Pressable>

          {/* Dates live on the log row, so there is nothing to date until one
              exists — the same rule web applies. */}
          {statusLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dateLabel ? `Dates: ${dateLabel}. Change them` : 'Set dates'}
              onPress={onEditDates}
              style={({ pressed }) => [styles.dates, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Text style={[type.eyebrow, text.muted]}>{dateLabel ?? 'SET DATES'}</Text>
            </Pressable>
          ) : null}

          {media.status ? (
            <>
              <Text style={[type.eyebrow, text.dim]}>·</Text>
              <Text style={[type.eyebrow, text.muted]}>
                {media.status.toUpperCase()}
                {media.partCount ? ` · ${media.partCount} ${unit}` : ''}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: HERO_HEIGHT,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bottom: {
    paddingHorizontal: layout.gutter,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  /** Anton 40/0.92 — the mockup's hero size, a step above the page titles. */
  title: {
    fontFamily: type.title.fontFamily,
    fontSize: 40,
    lineHeight: 38,
    color: color.fg,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipPink: {
    borderColor: surface.pinkBorderStrong,
    backgroundColor: surface.pinkSelected,
  },
  chipGlass: {
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: color.pink,
  },
  dates: {
    height: 30,
    justifyContent: 'center',
  },
});
