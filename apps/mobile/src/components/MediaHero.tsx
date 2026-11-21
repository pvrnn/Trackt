import { coverGradientStops } from '@trackt/client';
import { useLabels } from '../lib/labels';
import { useTranslation } from 'react-i18next';
import type { MediaDetail } from '@trackt/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { color, layout, space, text } from '../theme/tokens';
import { type } from '../theme/typography';
import { KIND_COLORS } from './KindDot';

export const HERO_HEIGHT = 310;

/**
 * The full-bleed header (`Mobile App.dc.html` §MEDIA DETAIL): whatever artwork
 * the source gives us — banner, else cover, else the title's own gradient —
 * under one scrim that guarantees the title. Identity only; everything you can
 * do sits below it.
 */
export function MediaHero({
  media,
  scrollY,
}: {
  media: MediaDetail;
  scrollY: SharedValue<number>;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [from, to] = coverGradientStops(media.kind, media.title);
  const art = media.bannerUrl ?? media.coverUrl;
  const unit =
    media.kind === 'manga' || media.kind === 'webtoon'
      ? t('media.part.chapters').toUpperCase()
      : t('media.part.episodes').toUpperCase();

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [0, 300], [0, 100], 'clamp') },
      { scale: scrollY.value < 0 ? 1 + Math.min(-scrollY.value, 160) / 600 : 1 },
    ],
  }));

  const meta = [
    labels.kindSingular(media.kind).toUpperCase(),
    media.year ? String(media.year) : null,
    media.genres.length > 0 ? media.genres.slice(0, 2).join(', ').toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const facts = [
    media.status?.toUpperCase() ?? null,
    media.seasonNumber ? t('media.season', { number: media.seasonNumber }) : null,
    media.partCount ? `${media.partCount} ${unit}` : null,
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
        {art ? (
          <Image
            source={{ uri: art }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <LinearGradient
          colors={[
            'rgba(14,12,16,0.6)',
            'rgba(14,12,16,0.12)',
            'rgba(14,12,16,0.2)',
            'rgba(14,12,16,0.9)',
            color.ink,
          ]}
          locations={[0, 0.26, 0.4, 0.68, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.bottom}>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: KIND_COLORS[media.kind] }]} />
          <Text style={[styles.meta, text.muted]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Text style={styles.title}>{media.title.toUpperCase()}</Text>
        {facts ? <Text style={[styles.facts, text.muted]}>{facts}</Text> : null}
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
    paddingBottom: space.sm,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  meta: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 1,
    includeFontPadding: false,
    flexShrink: 1,
  },
  title: {
    fontFamily: type.title.fontFamily,
    fontSize: 38,
    lineHeight: 37,
    color: color.fg,
  },
  facts: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 11,
    letterSpacing: 0.88,
  },
});
