import clsx from 'clsx';
import { useEffect, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_GENRE_FILTERS, type MediaKind, type StatusFilter } from '@trackt/shared';
import { useDebounced, useGenreSuggestions } from '@trackt/client';

/** The design's order: what is out now, then what is done, then what is coming. */
const STATUS_ORDER: StatusFilter[] = ['ongoing', 'ended', 'announced', 'cancelled'];

export interface DiscoverFiltersProps {
  /** The kind cell's value: genre suggestions come from that kind's vocabulary. */
  kind: MediaKind | undefined;
  genres: readonly string[];
  status: StatusFilter | undefined;
  onGenres: (genres: string[]) => void;
  onStatus: (status: StatusFilter | undefined) => void;
  /** Hits for the current filters, when the page knows them; names the SHOW button. */
  total: number | undefined;
}

/**
 * The console's last cell (`Search.dc.html` › FILTERS): the same grammar as
 * YEAR, label, value and chevron. It only toggles: the panel renders outside
 * the bar, whose `overflow: hidden` and backdrop filter would clip it.
 */
export function FiltersCell({
  open,
  active,
  panelId,
  onToggle,
  ref,
}: {
  open: boolean;
  active: number;
  panelId: string;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
      className={clsx(
        'fcell fcell-more cursor-pointer text-left focus-visible:shadow-[inset_0_0_0_2px_var(--color-pink)] focus-visible:outline-none',
        open && 'bg-white/[0.06]',
      )}
    >
      <span className="fcell-label">{t('discover.filters')}</span>
      <span
        className={clsx(
          'min-w-0 truncate pr-[22px] font-label text-xs font-bold tracking-[0.06em]',
          active > 0 ? 'text-pink-ink' : 'text-muted',
        )}
      >
        {active > 0 ? t('discover.filtersActive', { count: active }) : t('discover.filtersHint')}
      </span>
      <span
        aria-hidden
        className="fcell-chev transition-transform"
        // Replaces the stylesheet's 45° turn; a `rotate` utility would add to it.
        style={open ? { transform: 'rotate(225deg)', marginTop: -1 } : undefined}
      />
    </button>
  );
}

export function FilterPanel({
  id,
  kind,
  genres,
  status,
  onGenres,
  onStatus,
  total,
  onClose,
}: DiscoverFiltersProps & { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const active = genres.length + (status ? 1 : 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statuses: { value: StatusFilter | undefined; label: string }[] = [
    { value: undefined, label: t('discover.anyStatus') },
    ...STATUS_ORDER.map((value) => ({ value, label: t(`discover.statusFilter.${value}`) })),
  ];

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-[25]" onClick={onClose} />
      <div
        id={id}
        role="dialog"
        aria-label={t('discover.moreFilters')}
        className="absolute top-[calc(100%+8px)] right-0 z-[26] flex w-[min(440px,100%)] flex-col rounded-2xl bg-[#17131d] shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.13),0_28px_60px_-18px_rgb(0_0_0_/_0.95)]"
      >
        <section className="flex flex-col gap-3 px-5 py-[18px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="fcell-label">{t('discover.status')}</span>
            <span className="font-label text-[11px] font-semibold tracking-[0.08em] text-dim">
              {t('discover.pickOne')}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label={t('discover.status')}
            className="flex flex-wrap gap-1.5"
          >
            {statuses.map((option) => (
              <button
                key={option.value ?? 'any'}
                type="button"
                role="radio"
                aria-checked={status === option.value}
                onClick={() => onStatus(option.value)}
                className="fopt"
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <GenreSection kind={kind} genres={genres} onGenres={onGenres} />

        <div className="flex items-center gap-3 px-5 py-3.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.09)]">
          <button
            type="button"
            aria-disabled={active === 0}
            onClick={() => {
              if (active === 0) return;
              onGenres([]);
              onStatus(undefined);
            }}
            className={clsx(
              'h-9 font-label text-[11px] font-bold tracking-[0.08em]',
              active > 0 ? 'cursor-pointer text-pink-ink' : 'cursor-default text-dim',
            )}
          >
            {t('discover.reset')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-fg px-4 font-label text-xs font-bold tracking-[0.08em] whitespace-nowrap text-on-prism transition hover:brightness-90"
          >
            {total === undefined
              ? t('discover.showResults')
              : total === 0
                ? t('discover.noMatches')
                : t('discover.showTitles', { count: total })}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * GENRES: a search box over the vocabulary, never the vocabulary itself. The
 * picked genres stay listed (checked), and what the typed text finds follows.
 */
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

  return (
    <section className="flex flex-col gap-3 px-5 py-[18px] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.09)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="fcell-label">{t('discover.genres')}</span>
        <span className="font-label text-[11px] font-semibold tracking-[0.08em] text-dim">
          {genres.length > 0
            ? t('discover.genresSelected', { count: genres.length })
            : t('discover.pickAny')}
        </span>
      </div>
      <label className="fsearch">
        <span aria-hidden className="text-base leading-none text-dim">
          ⌕
        </span>
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            const first = found.find((genre) => !genres.includes(genre));
            if (event.key === 'Enter' && first && !full) {
              event.preventDefault();
              toggle(first);
              setText('');
            }
          }}
          aria-label={t('discover.genreSearch')}
          placeholder={t('discover.genreSearch')}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-dim [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((genre) => {
            const on = genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(genre)}
                className="fopt uppercase disabled:cursor-not-allowed disabled:opacity-40"
              >
                {on && (
                  <span aria-hidden className="text-pink-ink">
                    ✓
                  </span>
                )}
                {genre}
              </button>
            );
          })}
        </div>
      )}
      <p role="status" className="text-[13px] text-dim empty:hidden">
        {isError && typed
          ? t('discover.genresFailed')
          : typed && settled && found.length === 0
            ? t('discover.genresNoMatch', { text: text.trim() })
            : !typed && genres.length === 0
              ? t('discover.genreHint')
              : full
                ? t('discover.genresMax', { count: MAX_GENRE_FILTERS })
                : ''}
      </p>
    </section>
  );
}

/** What the panel has set, one removable token each, under the bar. */
export function FilterTokens({
  genres,
  status,
  onGenres,
  onStatus,
}: Omit<DiscoverFiltersProps, 'kind' | 'total'>) {
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
    <div className="-mt-3.5 flex flex-wrap items-center gap-2">
      {tokens.map((token) => (
        <span key={token.key} className="ftok">
          <span className="text-dim">{token.label}</span>
          {token.value}
          <button
            type="button"
            onClick={token.remove}
            aria-label={t('discover.removeFilter', { label: token.label, value: token.value })}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => {
          onGenres([]);
          onStatus(undefined);
        }}
        className="h-9 cursor-pointer px-2 font-label text-[11px] font-bold tracking-[0.08em] text-pink-ink"
      >
        {t('discover.clear')}
      </button>
    </div>
  );
}
