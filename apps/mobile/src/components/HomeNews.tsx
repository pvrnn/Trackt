import { coverGradientStops, formatNewsDate } from '@trackt/client';
import type { NewsArticleSummary } from '@trackt/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { intlLocale } from '../i18n';
import { resolveInstanceUrl } from '../lib/instance';
import { useLabels } from '../lib/labels';
import { Cover } from './Cover';
import { Touchable } from './Touchable';
import { color, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { font, type } from '../theme/typography';

/** Anton section title, a dim eyebrow on its baseline, and a pink link at the right edge. */
export function HomeSectionHead({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.headTitle}>
        <Text style={[type.section, text.fg]}>{title.toUpperCase()}</Text>
        {caption ? (
          <Text style={[styles.small, text.dim]} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** "ALL →" / "SEE ALL →": a label-sized link with the full 44pt target. */
export function HomeLink({ href, label }: { href: Href; label: string }) {
  return (
    <Touchable href={href} style={styles.link}>
      <Text style={[type.eyebrow, text.pinkInk]}>{label}</Text>
    </Touchable>
  );
}

function useMeta() {
  const { i18n } = useTranslation();
  const labels = useLabels();
  return (article: NewsArticleSummary) => {
    const kind = article.kinds[0];
    const date = formatNewsDate(article.publishedAt, intlLocale(i18n.language));
    return kind ? `${labels.kindSingular(kind).toUpperCase()} · ${date}` : date;
  };
}

function TopicTag({ article }: { article: NewsArticleSummary }) {
  const labels = useLabels();
  return (
    <View style={styles.tag}>
      <Text style={[styles.small, text.pinkInk]}>{labels.topic(article.topic).toUpperCase()}</Text>
    </View>
  );
}

/** The lead story: a 128pt banner over the headline and its standfirst. */
export function NewsLead({ article }: { article: NewsArticleSummary }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const source = resolveInstanceUrl(article.coverUrl);
  const [from, to] = coverGradientStops(article.kinds[0] ?? 'series', article.title);
  return (
    <Touchable href={`/news/${article.slug}`} style={styles.lead}>
      <View style={styles.banner}>
        <LinearGradient
          colors={[from, to]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {source ? (
          <Image
            source={{ uri: source }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : null}
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={[styles.small, text.pinkInk]}>{t('home.news.tracking')}</Text>
        </View>
      </View>
      <View style={styles.leadBody}>
        <View style={styles.metaRow}>
          <TopicTag article={article} />
          <Text style={[styles.small, text.dim]} numberOfLines={1}>
            {meta(article)}
          </Text>
        </View>
        <Text style={styles.leadTitle} numberOfLines={3}>
          {article.title}
        </Text>
        {article.dek ? (
          <Text style={[styles.dek, text.muted]} numberOfLines={3}>
            {article.dek}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

/** A follow-up story: 38×57 art, the tag and date, one headline. */
export function NewsBrief({ article }: { article: NewsArticleSummary }) {
  const meta = useMeta();
  return (
    <Touchable href={`/news/${article.slug}`} style={styles.brief}>
      <Cover
        kind={article.kinds[0] ?? 'series'}
        title={article.title}
        coverUrl={article.coverUrl}
        width={38}
        showTitle={false}
        style={styles.briefCover}
      />
      <View style={styles.briefBody}>
        <View style={styles.metaRow}>
          <TopicTag article={article} />
          <Text style={[styles.small, text.dim]} numberOfLines={1}>
            {meta(article)}
          </Text>
        </View>
        <Text style={styles.briefTitle} numberOfLines={2}>
          {article.title}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  headTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    flexShrink: 1,
  },
  small: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  link: {
    minHeight: layout.touchTarget,
    minWidth: layout.touchTarget,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: surface.pinkSelected,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  lead: {
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
    overflow: 'hidden',
  },
  banner: {
    height: 128,
    backgroundColor: color.ink,
  },
  // Opaque, because it sits on artwork (§08 ARTWORK).
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: 'rgba(217,107,176,0.6)',
    backgroundColor: color.onPrism,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.pink,
  },
  leadBody: {
    paddingTop: 14,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  leadTitle: {
    fontFamily: font.bodyBold,
    fontSize: 18,
    lineHeight: 23,
    color: color.fg,
  },
  dek: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
  },
  brief: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: stroke,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  briefCover: {
    borderRadius: 5,
  },
  briefBody: {
    flex: 1,
    gap: 6,
  },
  briefTitle: {
    fontFamily: font.bodySemibold,
    fontSize: 14,
    lineHeight: 18,
    color: color.fg,
  },
});
