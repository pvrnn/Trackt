import { TOPIC_LABELS, errorStatus, formatNewsDate, useNewsArticle } from '@trackt/client';
import type { NewsLinkedWork } from '@trackt/shared';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Cover } from '../../../src/components/Cover';
import { GlassCard } from '../../../src/components/GlassCard';
import { KindDot } from '../../../src/components/KindDot';
import { Markdown } from '../../../src/components/Markdown';
import {
  BackLink,
  EmptyState,
  Loading,
  PageScroll,
  SectionTitle,
} from '../../../src/components/Page';
import { Touchable } from '../../../src/components/Touchable';
import { color, layout, space, surface, text } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * One article (`GET /news/:slug`). The prose goes through the shared tokenizer
 * and the native `Markdown` renderer — never a `WebView` (ADR-0005).
 *
 * The linked works are the point of the screen as much as the prose is: they are
 * resolved to *this instance's* slugs server-side, so each one pushes straight
 * onto the media page.
 */
export default function NewsArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: article, isPending, isError, error } = useNewsArticle(slug);

  if (isPending) {
    return (
      <PageScroll>
        <BackLink label="News" />
        <Loading />
      </PageScroll>
    );
  }

  if (isError || !article) {
    const missing = errorStatus(error) === 404;
    return (
      <PageScroll>
        <BackLink label="News" />
        <EmptyState
          title={missing ? 'No such story' : 'Story unavailable'}
          body={
            missing
              ? 'This article has been withdrawn, or the link is wrong.'
              : "This instance couldn't reach the catalog's news feed."
          }
        />
      </PageScroll>
    );
  }

  const subjects = article.media.filter((work) => work.role === 'subject');
  const mentioned = article.media.filter((work) => work.role === 'mentioned');

  return (
    <PageScroll>
      <View style={styles.head}>
        <BackLink label="News" />
        <View style={styles.metaRow}>
          <Text style={[type.eyebrow, styles.tag]}>{TOPIC_LABELS[article.topic]}</Text>
          <Text style={[type.eyebrow, text.dim]}>{formatNewsDate(article.publishedAt)}</Text>
        </View>
        <Text style={[type.title, styles.title]}>{article.title}</Text>
        {article.dek ? <Text style={[type.body, styles.dek]}>{article.dek}</Text> : null}
      </View>

      <Markdown body={article.body} />

      {subjects.length > 0 ? <LinkedWorks title="About" works={subjects} /> : null}
      {mentioned.length > 0 ? <LinkedWorks title="Also mentioned" works={mentioned} /> : null}

      {article.sources.length > 0 ? (
        <View>
          <SectionTitle title="Sources" />
          <GlassCard style={styles.sources}>
            {article.sources.map((source, index) => (
              <Pressable
                key={`${source.url}-${index}`}
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(source.url)}
                style={({ pressed }) => [styles.sourceRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[type.bodySm, styles.sourceTitle]} numberOfLines={2}>
                  {source.title}
                </Text>
                <Text style={[type.eyebrow, text.dim]}>
                  {source.outlet}
                  {source.publishedAt ? ` · ${formatNewsDate(source.publishedAt)}` : ''}
                </Text>
              </Pressable>
            ))}
          </GlassCard>
        </View>
      ) : null}
    </PageScroll>
  );
}

function LinkedWorks({ title, works }: { title: string; works: NewsLinkedWork[] }) {
  return (
    <View>
      <SectionTitle title={title} />
      <View style={styles.works}>
        {works.map((work) => (
          <Touchable key={work.id} href={`/media/${work.slug}`} style={styles.work}>
            <Cover
              kind={work.kind}
              title={work.title}
              coverUrl={work.coverUrl}
              width={64}
              showTitle={false}
            />
            <View style={styles.workBody}>
              <Text style={[type.cardTitle, styles.title]} numberOfLines={2}>
                {work.title}
              </Text>
              <View style={styles.metaRow}>
                <KindDot kind={work.kind} />
                <Text style={[type.eyebrow, text.dim]}>{work.year ?? '—'}</Text>
              </View>
            </View>
          </Touchable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  tag: {
    color: color.pink,
  },
  title: {
    color: color.fg,
  },
  dek: {
    color: color.muted,
  },
  works: {
    gap: space.sm,
  },
  work: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  workBody: {
    flex: 1,
    gap: space.xs,
  },
  sources: {
    paddingHorizontal: space.lg,
  },
  sourceRow: {
    gap: space.xs,
    paddingVertical: space.md,
    minHeight: layout.touchTarget,
    justifyContent: 'center',
  },
  sourceTitle: {
    color: color.fg,
  },
});
