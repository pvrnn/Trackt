import type { MediaKind } from '@trackt/shared';
import type { SearchResult } from '@trackt/shared';

export type GameSearchRole =
  | 'edition'
  | 'expansion'
  | 'enhanced'
  | 'bundle'
  | 'port'
  | 'episode'
  | 'season'
  | 'mod'
  | 'fork'
  | 'update'
  | 'remake'
  | 'remaster'
  | 'other';

export interface GameSearchContext {
  role: GameSearchRole | null;
  editionTitle: string | null;
  parentTitle: string | null;
}

export interface GameSearchGroup {
  result: SearchResult;
  related: SearchResult[];
}

/** Pull the useful IGDB relationship context out of opaque provider metadata. */
export function gameSearchContext(
  kind: MediaKind,
  metadata: Record<string, unknown>,
): GameSearchContext | null {
  if (kind !== 'game') return null;
  const igdbType = typeof metadata.igdbType === 'string' ? metadata.igdbType.toLowerCase() : '';
  const editionTitle = typeof metadata.editionTitle === 'string' ? metadata.editionTitle : null;
  const parentTitle = typeof metadata.parentTitle === 'string' ? metadata.parentTitle : null;
  let role: GameSearchRole | null = null;

  if (editionTitle) role = 'edition';
  else if (igdbType.includes('expansion') || igdbType === 'dlc' || igdbType.includes('addon'))
    role = 'expansion';
  else if (igdbType.includes('expanded')) role = 'enhanced';
  else if (igdbType === 'bundle') role = 'bundle';
  else if (igdbType.includes('remake')) role = 'remake';
  else if (igdbType.includes('remaster')) role = 'remaster';
  else if (igdbType.includes('update')) role = 'update';
  else if (igdbType === 'port') role = 'port';
  else if (igdbType === 'episode') role = 'episode';
  else if (igdbType === 'season') role = 'season';
  else if (igdbType === 'mod') role = 'mod';
  else if (igdbType === 'fork') role = 'fork';
  else if (parentTitle) role = 'other';

  return { role, editionTitle, parentTitle };
}

/** Collapse IGDB editions and add-ons beneath their root game in result grids. */
export function groupGameSearchResults(results: SearchResult[]): GameSearchGroup[] {
  const byTitle = new Map<string, SearchResult>();
  for (const result of results) {
    if (result.kind === 'game') byTitle.set(result.title.toLowerCase(), result);
  }

  const roots = new Map<string, SearchResult>();
  const related = new Map<string, SearchResult[]>();
  const rootFor = (result: SearchResult, visited = new Set<string>()): SearchResult => {
    if (visited.has(result.id)) return result;
    visited.add(result.id);
    const parentTitle = gameSearchContext(result.kind, result.metadata ?? {})?.parentTitle;
    const parent = parentTitle ? byTitle.get(parentTitle.toLowerCase()) : undefined;
    return parent ? rootFor(parent, visited) : result;
  };

  for (const result of results) {
    const root = rootFor(result);
    roots.set(root.id, root);
    if (root.id !== result.id) {
      const children = related.get(root.id) ?? [];
      children.push(result);
      related.set(root.id, children);
    }
  }

  return [...roots.values()].map((result) => ({
    result,
    related: related.get(result.id) ?? [],
  }));
}
