import { useDebounced, useGenreSuggestions } from '@trackt/client';
import { MAX_GENRE_FILTERS, type MediaKind, type StatusFilter } from '@trackt/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, nativeInk, space, stroke, surface } from '../theme/tokens';
import { font } from '../theme/typography';
import { Icon } from './Icon';
import { Sheet, useSheetController } from './Sheet';

/** What is out now, then what is done, then what is coming (`Search.dc.html`). */
const STATUS_ORDER: StatusFilter[] = ['ongoing', 'ended', 'announced', 'cancelled'];

/**
 * The slab's FILTERS cell (`Mobile App.dc.html` › Discover): caption, value
 * and chevron, the grammar of the YEAR cell beside it.
 */
export function FiltersCell({ active, onPress }: { active: number; onPress: () => void }) {
  const { t } = useTranslation();
  const value =
    active > 0 ? t('discover.filtersActive', { count: active }) : t('discover.filtersNone');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('discover.filters')}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.caption}>{t('discover.filters')}</Text>
      <Text
        numberOfLines={1}
        style={[styles.cellValue, { color: active > 0 ? nativeInk.pinkInk : color.muted }]}
      >
        {value}
      </Text>
      <Icon name="caret-down" color={color.muted} size={10} />
    </Pressable>
  );
}

export interface FilterSheetProps {
  kind: MediaKind | undefined;
  genres: readonly string[];
  status: StatusFilter | undefined;
  onGenres: (genres: string[]) => void;
  onStatus: (status: StatusFilter | undefined) => void;
  /** Hits for the current filters, when known; names the SHOW button. */
  total: number | undefined;
  onClose: () => void;
}

/** STATUS and GENRES, in the sheet every choice on this app is made in. */
export function FilterSheet({
  kind,
  genres,
  status,
  onGenres,
  onStatus,
  total,
  onClose,
}: FilterSheetProps) {
  const { t } = useTranslation();
  const sheet = useSheetController(onClose);
  const active = genres.length + (status ? 1 : 0);
  const statuses: { value: StatusFilter | undefined; label: string }[] = [
    { value: undefined, label: t('discover.anyStatus') },
    ...STATUS_ORDER.map((value) => ({ value, label: t(`discover.statusFilter.${value}`) })),
  ];

  return (
    <Sheet
      title={t('discover.filters')}
      controller={sheet}
      tall
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: active === 0 }}
          disabled={active === 0}
          hitSlop={12}
          onPress={() => {
            onGenres([]);
            onStatus(undefined);
          }}
        >
          <Text style={[styles.textButton, { color: active > 0 ? nativeInk.pinkInk : color.dim }]}>
            {t('discover.reset')}
          </Text>
        </Pressable>
      }
    >
      <View style={styles.section}>
        <View style={styles.head}>
          <Text style={styles.caption}>{t('discover.status')}</Text>
          <Text style={styles.meta}>{t('discover.pickOne')}</Text>
        </View>
        <View accessibilityRole="radiogroup" style={styles.opts}>
          {statuses.map((option) => (
            <Option
              key={option.value ?? 'any'}
              label={option.label}
              on={status === option.value}
              role="radio"
              onPress={() => onStatus(option.value)}
            />
          ))}
        </View>
      </View>

      <GenreSection kind={kind} genres={genres} onGenres={onGenres} />

      <View style={[styles.foot, styles.divided]}>
        <Pressable
          accessibilityRole="button"
          onPress={sheet.dismiss}
          style={({ pressed }) => [styles.show, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.showLabel}>
            {total === undefined
              ? t('discover.showResults')
              : total === 0
                ? t('discover.noMatches')
                : t(total === 1 ? 'discover.showTitles_one' : 'discover.showTitles_other', {
                    count: total,
                  })}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** A search box over the genre vocabulary, never the vocabulary itself. */
function GenreSection({
  kind,
  genres,
  onGenres,
}: {
  kind: MediaKind | undefined;
  genres: readonly string[];
  onGenres: (genres: string[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const debounced = useDebounced(text, 200);
  const { genres: found, isFetching, isError } = useGenreSuggestions(kind, debounced);
  const typed = text.trim().length > 0;
  const settled = debounced === text && !isFetching;
  const full = genres.length >= MAX_GENRE_FILTERS;
  const options = [...genres, ...found.filter((genre) => !genres.includes(genre))];
  const toggle = (genre: string) => {
    if (genres.includes(genre)) onGenres(genres.filter((g) => g !== genre));
    else if (!full) onGenres([...genres, genre]);
  };
  const note =
    isError && typed
      ? t('discover.genresFailed')
      : typed && settled && found.length === 0
        ? t('discover.genresNoMatch', { text: text.trim() })
        : !typed && genres.length === 0
          ? t('discover.genreHint')
          : full
            ? t('discover.genresMax', { count: MAX_GENRE_FILTERS })
            : null;

  return (
    <View style={[styles.section, styles.divided]}>
      <View style={styles.head}>
        <Text style={styles.caption}>{t('discover.genres')}</Text>
        <Text style={styles.meta}>
          {genres.length > 0
            ? t('discover.genresSelected', { count: genres.length })
            : t('discover.pickAny')}
        </Text>
      </View>
      <View style={styles.search}>
        <Icon name="search" color={color.dim} size={16} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('discover.genreSearch')}
          placeholderTextColor={color.dim}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={() => {
            const first = found.find((genre) => !genres.includes(genre));
            if (first && !full) {
              toggle(first);
              setText('');
            }
          }}
          accessibilityLabel={t('discover.genreSearch')}
          style={styles.searchInput}
        />
      </View>
      {options.length > 0 ? (
        <View style={styles.opts}>
          {options.map((genre) => {
            const on = genres.includes(genre);
            return (
              <Option
                key={genre}
                label={genre.toUpperCase()}
                on={on}
                check
                disabled={!on && full}
                onPress={() => toggle(genre)}
              />
            );
          })}
        </View>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function Option({
  label,
  on,
  onPress,
  role = 'button',
  check = false,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  role?: 'button' | 'radio';
  check?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: on, disabled } : { selected: on, disabled }}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.opt,
        on && styles.optOn,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {check && on ? <Icon name="check" color={nativeInk.pinkInk} size={12} /> : null}
      <Text style={[styles.optLabel, { color: on ? color.fg : color.muted }]}>{label}</Text>
    </Pressable>
  );
}

/** What the sheet has set, one removable token each, under the slab. */
export function FilterTokens({
  genres,
  status,
  onGenres,
  onStatus,
}: Pick<FilterSheetProps, 'genres' | 'status' | 'onGenres' | 'onStatus'>) {
  const { t } = useTranslation();
  if (genres.length === 0 && !status) return null;
  const tokens = [
    ...(status
      ? [
          {
            key: 'status',
            label: t('discover.status'),
            value: t(`discover.statusFilter.${status}`),
            remove: () => onStatus(undefined),
          },
        ]
      : []),
    ...genres.map((genre) => ({
      key: `genre:${genre}`,
      label: t('discover.genre'),
      value: genre.toUpperCase(),
      remove: () => onGenres(genres.filter((g) => g !== genre)),
    })),
  ];
  return (
    <View style={styles.tokens}>
      {tokens.map((token) => (
        <View key={token.key} style={styles.token}>
          <Text style={[styles.tokenText, { color: color.dim }]}>{token.label}</Text>
          <Text style={styles.tokenText}>{token.value}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('discover.removeFilter', {
              label: token.label,
              value: token.value,
            })}
            hitSlop={10}
            onPress={token.remove}
            style={styles.tokenX}
          >
            <Icon name="close" color={color.muted} size={12} />
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => {
          onGenres([]);
          onStatus(undefined);
        }}
        style={styles.clear}
      >
        <Text style={[styles.textButton, { color: nativeInk.pinkInk }]}>{t('discover.clear')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 46,
    paddingLeft: space.lg,
    paddingRight: space.md,
    borderLeftWidth: stroke,
    borderLeftColor: surface.divider,
  },
  cellValue: {
    flex: 1,
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: 0.72,
  },
  caption: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: 1,
    color: color.dim,
  },
  section: {
    paddingVertical: space.lg,
    gap: space.md,
  },
  divided: {
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  meta: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
    color: color.dim,
  },
  opts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  optOn: {
    backgroundColor: 'rgba(217,107,176,0.16)',
    borderColor: 'rgba(217,107,176,0.6)',
  },
  optLabel: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: 0.96,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: surface.glass,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    padding: 0,
    fontFamily: font.body,
    fontSize: 15,
    color: color.fg,
  },
  note: {
    fontFamily: font.body,
    fontSize: 13,
    color: color.dim,
  },
  foot: {
    paddingTop: space.md,
  },
  textButton: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
  },
  show: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: color.fg,
  },
  showLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: 0.96,
    color: color.onPrism,
  },
  tokens: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: -space.sm,
    marginBottom: space.lg,
  },
  token: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 30,
    paddingLeft: 11,
    paddingRight: 3,
    borderRadius: 8,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  tokenText: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
    color: color.fg,
  },
  tokenX: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clear: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
