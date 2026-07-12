import { useEffect, useState } from 'react';
import { SearchResultSchema, type MediaKind, type SearchResult } from '@trackt/shared';
import { api } from './http';

export interface MediaSearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Kept across reloads so the grid doesn't flicker while a new query is in flight. */
  results: SearchResult[];
}

/**
 * Debounced instance-catalog search against `GET /api/v1/search`.
 * Empty query → idle with no request. In-flight requests are aborted on every
 * change, so stale responses can never overwrite newer ones.
 */
export function useMediaSearch(query: string, kind?: MediaKind): MediaSearchState {
  const [state, setState] = useState<MediaSearchState>({ status: 'idle', results: [] });
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setState({ status: 'idle', results: [] });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const searchParams: Record<string, string> = { q };
        if (kind) searchParams.kind = kind;
        const json = await api.get('search', { searchParams, signal: controller.signal }).json();
        const results = SearchResultSchema.array().parse(json);
        setState({ status: 'success', results });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', results: [] });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, kind]);

  return state;
}
