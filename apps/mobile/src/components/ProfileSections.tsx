import {
  MEDIA_KINDS,
  PART_KIND_BY_MEDIA,
  type FavoriteEntry,
  type InProgressEntry,
  type MediaKind,
  type ProfileTaste,
} from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLabels } from '../lib/labels';
import { PRISM, color, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { font, type, displayLine } from '../theme/typography';
import { Avatar } from './Avatar';
import { Cover } from './Cover';
import { GlassCard } from './GlassCard';
import { KIND_COLORS, KindDot } from './KindDot';
import { Icon } from './Icon';
import { MiniTimeline, useTimelineHistory } from './MiniTimeline';
import { SectionTitle } from './Page';
import { PrismText } from './PrismText';
import { ShelfItem } from './Shelf';
import { Touchable } from './Touchable';

/**
 * The profile's blocks (`Mobile App.dc.html`, PROFILE), shared by the own tab
 * and `users/[username]` so the two cannot drift apart.
 */

export function ProfileIdentity({
  name,
  username,
  image,
  friendCount,
  dayStreak,
  action,
}: {
  name: string;
  username: string;
  image: string | null | undefined;
  friendCount: number | undefined;
  dayStreak: number | undefined;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.identity}>
      <Avatar name={name} image={image} size={68} />
      <View style={styles.identityText}>
        <Text style={styles.name} numberOfLines={2}>
          {name.toUpperCase()}
        </Text>
        <Text style={[type.eyebrow, text.dim]}>
          @{username.toUpperCase()}
          {friendCount !== undefined
            ? ` · ${friendCount} ${t('social.friendLabel', { count: friendCount })}`
            : ''}
          {dayStreak ? (
            <Text style={text.pink}>
              {' · ● '}
              {t('profile.header.streak', { count: dayStreak })}
            </Text>
          ) : null}
        </Text>
      </View>
      {action}
    </View>
  );
}

/** One glass band, four cells split by rules: the year in numbers. */
export function StatStrip({ items }: { items: { value: number; label: string }[] }) {
  return (
    <View style={styles.strip}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.stripCell, index > 0 && styles.stripRule]}>
          <PrismText style={styles.stripValue}>{String(item.value)}</PrismText>
          <Text style={styles.stripLabel} numberOfLines={2}>
            {item.label.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const TOP = 'top';
type FavouriteTab = MediaKind | typeof TOP;

/**
 * One swipeable row. TOP PICKS is every kind's #1; a kind tab is that kind's
 * whole ranking — the row scrolls, so there is no "see all" to expand.
 */
export function Favourites({
  favorites,
  emptyMessage,
}: {
  favorites: FavoriteEntry[];
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [tab, setTab] = useState<FavouriteTab>(TOP);

  const blocks = MEDIA_KINDS.map((kind) => ({
    kind,
    items: favorites.filter((entry) => entry.kind === kind),
  })).filter((block) => block.items.length > 0);
  const block = tab === TOP ? undefined : blocks.find((candidate) => candidate.kind === tab);

  const title = (
    <SectionTitle
      title={t('profile.favourites.title')}
      action={
        favorites.length > 0 ? (
          <Text style={[type.eyebrow, text.dim]}>
            {t('profile.favourites.total', { count: favorites.length })}
          </Text>
        ) : undefined
      }
    />
  );

  if (blocks.length === 0) {
    return (
      <View style={styles.section}>
        {title}
        <Text style={[type.bodySm, text.muted]}>{emptyMessage}</Text>
      </View>
    );
  }

  const row = block
    ? block.items.map((entry) => ({
        entry,
        eyebrow: t('profile.favourites.rank', { rank: entry.rank }),
      }))
    : blocks.map(({ kind, items }) => ({
        entry: items[0] as FavoriteEntry,
        eyebrow: t('profile.favourites.topOf', { kind: labels.kindSingular(kind) }),
      }));

  const tabs: { key: FavouriteTab; label: string; count: number | null }[] = [
    { key: TOP, label: t('profile.favourites.topPicks'), count: null },
    ...blocks.map(({ kind, items }) => ({
      key: kind,
      label: labels.kind(kind),
      count: items.length,
    })),
  ];

  return (
    <View>
      {title}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.tabs}
      >
        {tabs.map((item) => {
          const on = item.key === tab;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setTab(item.key)}
              style={styles.tab}
            >
              {item.key !== TOP ? <KindDot kind={item.key} /> : null}
              <Text style={[type.eyebrow, on ? text.fg : text.muted]}>
                {item.label.toUpperCase()}
              </Text>
              {item.count !== null ? (
                <Text style={[type.eyebrow, text.dim]}>{item.count}</Text>
              ) : null}
              {on ? (
                <LinearGradient
                  colors={[...PRISM]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.tabLine}
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.favRow}
      >
        {row.map(({ entry, eyebrow }) => (
          <ShelfItem
            key={entry.id}
            href={`/media/${entry.slug}`}
            kind={entry.kind}
            title={entry.title}
            coverUrl={entry.coverUrl}
            captionLines={2}
            accessibilityLabel={`${entry.title}, ${eyebrow}`}
          >
            <View style={styles.favEyebrow}>
              <KindDot kind={entry.kind} />
              <Text style={[type.eyebrow, text.muted]} numberOfLines={1}>
                {eyebrow.toUpperCase()}
              </Text>
            </View>
          </ShelfItem>
        ))}
      </ScrollView>
    </View>
  );
}

/** What is open right now, capped server-side, with the uncapped count beside it. */
export function RightNow({ entries, total }: { entries: InProgressEntry[]; total: number }) {
  const { t } = useTranslation();
  const labels = useLabels();
  if (entries.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle
        title={t('profile.rightNow.title')}
        action={
          <Text style={[type.eyebrow, text.dim]}>
            {t('profile.rightNow.count', { shown: entries.length, count: total })}
          </Text>
        }
      />
      <View style={styles.nowList}>
        {entries.map((entry) => {
          const partKind = PART_KIND_BY_MEDIA[entry.kind];
          const pct = entry.total ? Math.min(entry.watched / entry.total, 1) : null;
          const where = !partKind
            ? labels.status('in_progress')
            : entry.total
              ? t(`profile.rightNow.${partKind}OfTotal`, {
                  count: entry.watched,
                  total: entry.total,
                })
              : t(`profile.rightNow.${partKind}`, { count: entry.watched });
          return (
            <Touchable key={entry.id} href={`/media/${entry.slug}`} style={styles.nowRow}>
              <Cover
                kind={entry.kind}
                title={entry.title}
                coverUrl={entry.coverUrl}
                width={40}
                showTitle={false}
                style={styles.nowCover}
              />
              <View style={styles.nowText}>
                <Text style={[type.cardTitle, text.fg]} numberOfLines={1}>
                  {entry.title}
                </Text>
                <View style={styles.nowMeta}>
                  <KindDot kind={entry.kind} />
                  <Text style={[type.eyebrow, text.muted, styles.shrink]} numberOfLines={1}>
                    {`${labels.kindSingular(entry.kind)} · ${where}`.toUpperCase()}
                  </Text>
                </View>
                {pct !== null ? (
                  <View style={styles.track}>
                    <LinearGradient
                      colors={[...PRISM]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]}
                    />
                  </View>
                ) : null}
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * History's arrow, small. `username` reads someone else's; the HISTORY link is
 * own-profile only, because the History screen has no handle to read.
 */
export function ProfileTimeline({ username }: { username?: string }) {
  const { t } = useTranslation();
  const history = useTimelineHistory({ username });
  if (!history.ready || history.isError || history.entries.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle
        title={t('profile.timeline.title')}
        action={
          username === undefined ? (
            <Touchable href="/history" style={styles.sectionLink}>
              <Text style={[type.eyebrow, text.pink]}>{t('profile.timeline.open')}</Text>
              <Icon name="chevron-right" color={color.pink} size={14} />
            </Touchable>
          ) : undefined
        }
      />
      <MiniTimeline entries={history.entries} />
    </View>
  );
}

/** Counts of tracked titles, not time: the server has no watch-time to divide. */
export function Taste({ taste }: { taste: ProfileTaste }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const tracked = taste.kinds.reduce((sum, entry) => sum + entry.count, 0);
  if (tracked === 0) return null;
  const topGenre = taste.genres[0]?.count ?? 0;
  return (
    <GlassCard style={styles.taste}>
      <Text style={styles.cardTitle}>{t('profile.taste.title').toUpperCase()}</Text>
      <View style={styles.tasteBlock}>
        <Text style={[type.eyebrow, text.dim]}>{t('profile.taste.kinds')}</Text>
        <View style={styles.mixBar}>
          {taste.kinds.map((entry) => (
            <View
              key={entry.kind}
              style={[
                styles.mixSegment,
                { flexGrow: entry.count, backgroundColor: KIND_COLORS[entry.kind] },
              ]}
            />
          ))}
        </View>
        <View style={styles.legend}>
          {taste.kinds.map((entry) => (
            <View key={entry.kind} style={styles.legendItem}>
              <KindDot kind={entry.kind} />
              <Text style={[type.eyebrow, text.muted, styles.shrink]} numberOfLines={1}>
                {labels.kind(entry.kind).toUpperCase()}{' '}
                <Text style={text.fg}>{Math.round((entry.count / tracked) * 100)}%</Text>
              </Text>
            </View>
          ))}
        </View>
      </View>
      {taste.genres.length > 0 ? (
        <View style={styles.genres}>
          <Text style={[type.eyebrow, text.dim]}>{t('profile.taste.genres')}</Text>
          {taste.genres.map((genre) => (
            <View key={genre.name} style={styles.genreRow}>
              <Text style={[styles.genreName, text.fg]} numberOfLines={1}>
                {genre.name}
              </Text>
              <View style={styles.genreTrack}>
                <View
                  style={[
                    styles.genreFill,
                    { width: `${Math.round((genre.count / topGenre) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[type.eyebrow, text.muted, styles.genreCount]}>{genre.count}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
  },
  identityText: {
    flex: 1,
    gap: space.xs,
  },
  name: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: displayLine(28),
    color: color.fg,
  },
  strip: {
    flexDirection: 'row',
    borderRadius: radius.cardSm,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  stripCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: space.xs + 1,
    paddingVertical: space.md,
    paddingHorizontal: space.xs + 2,
  },
  stripRule: {
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  stripValue: {
    fontFamily: font.display,
    fontSize: 22,
    lineHeight: displayLine(22),
  },
  stripLabel: {
    ...type.tabLabel,
    color: color.dim,
    textAlign: 'center',
  },
  section: {
    gap: space.md,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: layout.touchTarget,
  },
  bleed: {
    marginHorizontal: -layout.gutter,
    flexGrow: 0,
  },
  tabs: {
    paddingHorizontal: space.md,
    marginBottom: space.md,
    borderBottomWidth: stroke,
    borderBottomColor: surface.divider,
    flexGrow: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: 46,
    paddingHorizontal: space.sm + 2,
  },
  tabLine: {
    position: 'absolute',
    left: space.sm + 1,
    right: space.sm + 1,
    bottom: 0,
    height: 2,
    borderRadius: 2,
  },
  favRow: {
    gap: space.md,
    paddingHorizontal: layout.gutter,
  },
  favEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    width: 96,
    marginTop: space.sm,
  },
  nowList: {
    gap: space.sm + 2,
  },
  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 1,
    paddingLeft: space.sm + 1,
    paddingRight: space.md + 2,
    borderRadius: radius.cardSm - 2,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  nowCover: {
    borderRadius: radius.thumb,
  },
  nowText: {
    flex: 1,
    minWidth: 0,
    gap: space.xs,
  },
  nowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
  },
  shrink: {
    flexShrink: 1,
  },
  track: {
    height: 3,
    marginTop: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  taste: {
    paddingVertical: space.lg,
    paddingHorizontal: space.lg + 2,
    gap: space.lg,
  },
  cardTitle: {
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: displayLine(20),
    color: color.fg,
  },
  tasteBlock: {
    gap: space.sm + 2,
  },
  mixBar: {
    flexDirection: 'row',
    gap: 2,
    height: 10,
  },
  mixSegment: {
    flexBasis: 0,
    minWidth: 4,
    borderRadius: 3,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.xs + 2,
  },
  legendItem: {
    width: '33.33%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    paddingRight: space.sm,
  },
  genres: {
    gap: space.sm + 1,
  },
  genreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
  },
  genreName: {
    width: 112,
    fontFamily: font.bodySemibold,
    fontSize: 14,
    lineHeight: 18,
  },
  genreTrack: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  genreFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.pink,
  },
  genreCount: {
    width: 24,
    textAlign: 'right',
  },
});
