import { externalProfiles } from '@trackt/client';
import type { MediaDetail, RelatedWork, SearchResult } from '@trackt/shared';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { intlLocale } from '../i18n';
import { SectionTitle } from './Page';
import { Shelf, ShelfItem } from './Shelf';
import {
  color,
  gutter,
  layout,
  nativeInk,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../theme/tokens';
import { font } from '../theme/typography';

type Fact = { label: string; value: string; accent?: boolean; wide?: boolean };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];

/** Full ISO dates read as '2 Feb 2024'; partial ones ('2024-02') stay as given. */
function factDate(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The FACTS strip: what the catalog states about the work, two across. Only
 * what the payload carries — a fact the provider did not publish is left out,
 * not filled with a dash.
 */
export function FactsStrip({ media }: { media: MediaDetail }) {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);
  const meta = media.metadata;
  const status =
    media.status?.toUpperCase() ??
    (typeof meta.igdbStatus === 'string' ? meta.igdbStatus.toUpperCase() : null);
  const released =
    media.releaseDate ??
    (typeof meta.startDate === 'string' ? meta.startDate : null) ??
    (media.year !== null ? String(media.year) : null);
  const ended = typeof meta.endDate === 'string' ? meta.endDate : null;
  const creators = [
    ...new Set(
      (Array.isArray(meta.credits) ? meta.credits : [])
        .map((credit: unknown) =>
          credit && typeof credit === 'object' && 'name' in credit ? credit.name : null,
        )
        .filter((name): name is string => typeof name === 'string' && name !== ''),
    ),
  ];
  const studios = strings(meta.studios);

  const half: Fact[] = [];
  if (status) {
    half.push({
      label: t('media.details.status'),
      value: status,
      accent: media.status === 'airing' || media.status === 'publishing',
    });
  }
  if (released)
    half.push({ label: t('media.details.released'), value: factDate(released, locale) });
  if (ended && media.status === 'ended') {
    half.push({ label: t('media.details.ended'), value: factDate(ended, locale) });
  }
  if (studios.length > 0) {
    half.push({ label: t('media.details.studio'), value: studios.slice(0, 2).join(', ') });
  }
  if (creators.length > 0) {
    half.push({ label: t('media.details.createdBy'), value: creators.slice(0, 2).join(', ') });
  }
  if (typeof meta.duration === 'number' && meta.duration > 0) {
    half.push({
      label: t('media.details.runtime'),
      value: t('media.details.runtimeValue', { minutes: meta.duration }),
    });
  }
  if (typeof meta.volumes === 'number' && meta.volumes > 0) {
    half.push({ label: t('media.details.volumes'), value: String(meta.volumes) });
  }
  if (half.length % 2 === 1) half[half.length - 1] = { ...half[half.length - 1]!, wide: true };

  const facts: Fact[] = [...half];
  if (media.genres.length > 0) {
    facts.push({ label: t('media.details.genres'), value: media.genres.join(', '), wide: true });
  }
  if (media.synonyms.length > 0) {
    facts.push({
      label: t('media.details.alsoKnownAs'),
      value: media.synonyms.join(' · '),
      wide: true,
    });
  }

  if (facts.length === 0) return null;

  let column = 0;
  let row = 0;
  return (
    <View style={styles.strip}>
      {facts.map((fact) => {
        if (fact.wide && column === 1) {
          column = 0;
          row += 1;
        }
        const ruled = [row > 0 && styles.ruleTop, column === 1 && styles.ruleLeft];
        const cell = (
          <View
            key={fact.label}
            style={[styles.cell, fact.wide ? styles.wide : styles.half, ...ruled]}
          >
            <Text style={styles.factLabel}>{fact.label}</Text>
            <Text style={[styles.factValue, fact.accent ? text.pinkInk : text.fg]}>
              {fact.value}
            </Text>
          </View>
        );
        if (fact.wide || column === 1) {
          column = 0;
          row += 1;
        } else {
          column = 1;
        }
        return cell;
      })}
    </View>
  );
}

/** Related works, then where the metadata came from. */
export function MediaFooter({ media }: { media: MediaDetail }) {
  const { t } = useTranslation();
  const external = externalProfiles(media.kind, media.externalIds, media.metadata);
  return (
    <View style={styles.footer}>
      {media.relations.length > 0 ? (
        <RelatedShelf title={t('media.relatedTitle')} works={media.relations} />
      ) : media.related.length > 0 ? (
        <RelatedShelf title={t('media.youMightLike')} works={media.related} />
      ) : null}

      {external.length > 0 ? (
        <View style={[gutter, styles.source]}>
          <Text style={styles.sourceLabel}>{t('media.details.metadataFrom')}</Text>
          {external.map(({ provider, url }) =>
            url ? (
              <Pressable
                key={provider}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(url)}
                style={({ pressed }) => [styles.sourceLink, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.sourceText, text.pinkInk]}>{provider.toUpperCase()} ↗</Text>
              </Pressable>
            ) : (
              <Text key={provider} style={[styles.sourceText, text.muted]}>
                {provider.toUpperCase()}
              </Text>
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

function RelatedShelf({ title, works }: { title: string; works: (RelatedWork | SearchResult)[] }) {
  return (
    <View>
      <View style={gutter}>
        <SectionTitle title={title} />
      </View>
      <Shelf padding="gutter">
        {works.map((work) => (
          <ShelfItem
            key={work.id}
            href={`/media/${work.slug}`}
            kind={work.kind}
            title={work.title}
            coverUrl={work.coverUrl}
            width={104}
            captionLines={2}
          >
            {'relation' in work ? (
              <Text style={styles.relation}>{work.relation.toUpperCase()}</Text>
            ) : null}
          </ShelfItem>
        ))}
      </Shelf>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: radius.card,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  cell: {
    paddingVertical: 13,
    paddingHorizontal: space.lg,
    gap: 5,
    minWidth: 0,
  },
  half: {
    width: '50%',
  },
  wide: {
    width: '100%',
  },
  ruleTop: {
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  ruleLeft: {
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  factLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.dim,
    includeFontPadding: false,
  },
  factValue: {
    fontFamily: font.bodySemibold,
    fontSize: 14,
    lineHeight: 18,
  },
  footer: {
    gap: layout.sectionGap,
    marginTop: layout.sectionGap,
  },
  relation: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: nativeInk.pinkInk,
    marginTop: space.sm,
  },
  source: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    minHeight: layout.touchTarget,
  },
  sourceLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 0.8,
    color: color.dim,
  },
  sourceLink: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
  },
  sourceText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
  },
});
