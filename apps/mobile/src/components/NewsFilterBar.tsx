import { KIND_LABELS } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { useEffect, useRef, useState } from 'react';
import { WINDOWS, everyKind, useWindowCounts, type WindowKey } from '../lib/news-filters';
import { FilterBar, type Filter, type MenuRow } from './FilterBar';

/** How long an unfinished kind selection sits before the feed refetches. */
const KINDS_SETTLE_MS = 5000;

/**
 * The news feed's two filters, over the shared {@link FilterBar}: the kinds a
 * story can be about, and how far back to look.
 *
 * ALL KINDS is a row of its own rather than every other row ticked. Picking a
 * kind drops it; unticking the last kind returns to it.
 *
 * A kind selection is a *draft* while the menu is open, so picking three kinds
 * is one request rather than three feeds reshuffling under the finger. The
 * draft commits when the menu closes, or after {@link KINDS_SETTLE_MS} of not
 * being touched, whichever comes first.
 */
export function NewsFilterBar({
  kinds,
  onKinds,
  window,
  onWindow,
  summary,
}: {
  kinds: MediaKind[];
  onKinds: (kinds: MediaKind[]) => void;
  window: WindowKey;
  onWindow: (key: WindowKey) => void;
  summary?: string | undefined;
}) {
  const [draft, setDraft] = useState<MediaKind[]>(kinds);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counts = useWindowCounts(kinds);
  const current = WINDOWS.find((entry) => entry.key === window) ?? WINDOWS[3];

  useEffect(() => () => clearTimeout(settle.current ?? undefined), []);

  const commit = (next: MediaKind[]) => {
    clearTimeout(settle.current ?? undefined);
    settle.current = null;
    onKinds(next);
  };

  const toggleKind = (key: string) => {
    const picked =
      key === 'all'
        ? []
        : draft.includes(key as MediaKind)
          ? draft.filter((value) => value !== key)
          : [...draft, key as MediaKind];
    // Ticking the last unticked kind is ALL KINDS said the long way.
    const next = everyKind(picked) ? [] : picked;
    setDraft(next);
    clearTimeout(settle.current ?? undefined);
    settle.current = setTimeout(() => commit(next), KINDS_SETTLE_MS);
  };

  const kindRows: MenuRow[] = [
    { key: 'all', label: 'All kinds', selected: draft.length === 0 },
    ...MEDIA_KINDS.map((value) => ({
      key: value,
      label: KIND_LABELS[value],
      selected: draft.includes(value),
    })),
  ];

  const windowRows: MenuRow[] = WINDOWS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: counts[entry.key],
    selected: entry.key === window,
  }));

  const filters: Filter[] = [
    {
      key: 'kinds',
      icon: 'list',
      label: kindsLabel(draft),
      rows: kindRows,
      // Mark, not fill: a multi-selection routinely has every row selected,
      // and six filled rows says nothing about which ones are on.
      highlight: 'mark',
      stayOpen: true,
      onSelect: toggleKind,
      onClose: () => commit(draft),
    },
    {
      key: 'window',
      icon: 'clock',
      label: current.label,
      rows: windowRows,
      onSelect: (key) => onWindow(key as WindowKey),
    },
  ];

  return <FilterBar filters={filters} summary={summary} />;
}

/**
 * What the kinds pill says. Only a single kind is named — "ANIME + MANGA"
 * beside the date pill leaves no room for the story count on the same row.
 */
function kindsLabel(kinds: MediaKind[]): string {
  if (everyKind(kinds)) return 'All kinds';
  const only = kinds[0];
  if (kinds.length === 1 && only) return KIND_LABELS[only];
  return `${kinds.length} kinds`;
}
