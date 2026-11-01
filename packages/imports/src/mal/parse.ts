import type { ImportKind } from '../types.js';
import type { MalFavorite } from './schemas.js';

/**
 * The profile's favourites page → plain rows. String in, structure out: nothing
 * here knows about `fetch`, the import vocabulary or the catalog, so the parser
 * is tested against a page captured from the live site and nothing else.
 *
 * Anchor on the two headings and the `boxlist-container` classes MAL prints for
 * each favourite kind. The page embeds no provider ids in an attribute, so the
 * id is read from the work's own link, the way a person would.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
};

function decode(value: string): string {
  return value.replace(/&(#?[a-zA-Z0-9]+);/g, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

export interface FavoritesPage {
  items: MalFavorite[];
  /**
   * How many of the two sections the page actually carried. A page with none is
   * a layout change (or a profile with favourites turned off), and the caller
   * says so instead of reporting an empty favourites list as fact.
   */
  sections: number;
}

function sectionOf(html: string, heading: string): string | null {
  const start = html.indexOf(`<h5>${heading}</h5>`);
  if (start < 0) return null;
  const container = html.indexOf(`<div class="boxlist-container ${heading.toLowerCase()}`, start);
  if (container < 0) return null;
  const next = html.indexOf('<h5>', container);
  return html.slice(container, next < 0 ? html.length : next);
}

function readSection(html: string, heading: string, kind: ImportKind): MalFavorite[] | null {
  const block = sectionOf(html, heading);
  if (block === null) return null;

  const items: MalFavorite[] = [];
  for (const chunk of block.split('<div class="boxlist').slice(1)) {
    const link = new RegExp(`href="[^"]*?/${kind}/(\\d+)`).exec(chunk);
    const title = /<div class="title">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1];
    if (!link?.[1] || !title) continue;

    // `TV ･ 2006` / `Novel ･ 2002`: the year is the last number on the line, and
    // a one-shot without one simply has no year.
    const meta = /class="di-ib mt4 fn-grey2"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? '';
    const yearMatch = /(\d{4})\s*$/.exec(decode(meta.replace(/<[^>]+>/g, ' ')).trim());

    items.push({
      kind,
      externalId: link[1],
      title: decode(title.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
      year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
    });
  }
  return items;
}

/** The anime and manga a profile pins as favourites. Characters and people are not works. */
export function parseFavorites(html: string): FavoritesPage {
  const anime = readSection(html, 'Anime', 'anime');
  const manga = readSection(html, 'Manga', 'manga');
  return {
    items: [...(anime ?? []), ...(manga ?? [])],
    sections: (anime === null ? 0 : 1) + (manga === null ? 0 : 1),
  };
}
