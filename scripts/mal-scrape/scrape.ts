/**
 * MyAnimeList → Trackt catalog. A standalone operator tool, not a service.
 *
 * MAL retired its public API v1 and v2 needs OAuth client registration, so this
 * reads the public detail page instead. One page yields one work plus every
 * relation MAL lists on it; `--anilist` then resolves the AniList ids that
 * define canonical identity (ADR-0001) and derives publishable ids.
 *
 * Deliberately standalone: node builtins only, no workspace imports, no build
 * step. That is also why relative imports carry `.ts` extensions — node strips
 * the types at run time rather than compiling first. The three facts this file
 * restates from the workspace (the catalog namespace, the media enums, the
 * relation vocabulary) are pinned by `test/scrape.test.ts`, which reads them
 * back out of `packages/shared/src/`.
 *
 * Run: `node scripts/mal-scrape/scrape.ts <url|id> [options]` (`--help`).
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ *
 * The workspace facts this tool restates (guarded by test/scrape.test.ts)
 * ------------------------------------------------------------------ */

/** RFC 4122 v5 namespace, frozen forever by ADR-0001. */
export const TRACKT_CATALOG_NAMESPACE = 'f8d11238-d681-551c-875d-5ac53892f6e7';

export const MEDIA_KINDS = ['movie', 'series', 'anime', 'manga', 'webtoon'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ['announced', 'airing', 'publishing', 'ended', 'cancelled'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_RELATION_TYPES = ['sequel', 'adaptation', 'spinoff', 'related'] as const;
export type MediaRelationType = (typeof MEDIA_RELATION_TYPES)[number];

/** Mirrors `IDENTITY_PROVIDER_BY_KIND` in packages/shared/src/canonical-id.ts. */
export const IDENTITY_PROVIDER_BY_KIND: Record<MediaKind, string | null> = {
  movie: 'tmdb',
  series: 'tmdb',
  anime: 'anilist',
  manga: 'anilist',
  webtoon: null,
};

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type MalPageType = 'anime' | 'manga';

/** One related entry, in MAL's own vocabulary. */
export interface MalRelationRef {
  malId: number;
  malType: MalPageType;
  slug: string;
  title: string;
  /** MAL's label as printed: `Sequel`, `Side Story`, `Alternative Version`, … */
  label: string;
  /** MAL's entry format as printed: `TV`, `Movie`, `ONA`, `Special`, `Music`, `Manga`, `Novel`, … */
  format: string | null;
  /** Listed behind MAL's "More related entries" toggle rather than in the tile grid. */
  hidden: boolean;
  via: 'tile' | 'table';
}

/** Everything one MAL detail page states, before any catalog opinion is applied. */
export interface MalPage {
  url: string;
  malId: number;
  malType: MalPageType;
  titleRomaji: string;
  titleEnglish: string | null;
  titleJapanese: string | null;
  synonyms: string[];
  /** MAL's Type field: `TV`, `Movie`, `ONA`, `Music`, `Manga`, `Novel`, `Manhwa`, … */
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  status: string | null;
  airedStart: string | null;
  airedEnd: string | null;
  premiered: { season: string; year: number } | null;
  broadcast: string | null;
  source: string | null;
  duration: string | null;
  rating: string | null;
  genres: string[];
  demographics: string[];
  studios: string[];
  producers: string[];
  licensors: string[];
  serialization: string[];
  authors: string[];
  score: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  coverUrl: string | null;
  externalLinks: { name: string; url: string }[];
  relations: MalRelationRef[];
}

/** A catalog row plus provenance. `id` stays null until AniList identity is known. */
export interface DraftMedia {
  id: string | null;
  kind: MediaKind;
  title: string;
  synonyms: string[];
  year: number | null;
  status: MediaStatus | null;
  genres: string[];
  partCount: number | null;
  seasonNumber: number | null;
  externalIds: Record<string, string | number>;
  description: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
}

/** An edge waiting for ids. `direction` says which end this page's work is. */
export interface PlannedRelation {
  type: MediaRelationType;
  direction: 'forward' | 'reverse';
  target: MalRelationRef;
  source: { malId: number; malType: MalPageType };
}

export interface ScrapedWork {
  page: MalPage;
  media: DraftMedia;
  relations: PlannedRelation[];
  skippedRelations: { label: string; target: string; targetMalId: number; reason: string }[];
  warnings: string[];
}

export interface Payload {
  generatedAt: string;
  sources: { url: string; malId: number; malType: MalPageType; title: string }[];
  media: DraftMedia[];
  relations: {
    fromId: string;
    toId: string;
    type: MediaRelationType;
    from?: { malId: number; kind: MediaKind; title: string };
    to?: { malId: number; kind: MediaKind; title: string };
  }[];
  skipped: { malId: number; title: string; reason: string }[];
  warnings: string[];
}

/** An empty seed file, for a run that has nothing to fold into yet. */
export function emptySeed(): SeedFile {
  return {
    generatedAt: new Date().toISOString(),
    catalog_media: [],
    catalog_media_relation: [],
    urls: {},
    report: { sources: [], skipped: [], warnings: [] },
  };
}

/** A `catalog_media` insert, in the column names drizzle uses for the table. */
export interface SeedMediaRow {
  id: string;
  kind: MediaKind;
  title: string;
  synonyms: string[];
  year: number | null;
  status: MediaStatus | null;
  genres: string[];
  partCount: number | null;
  seasonNumber: number | null;
  externalIds: Record<string, string | number>;
  description: string | null;
  coverUrl: string | null;
  /** Wide header artwork; only AniList publishes one, and MAL pages carry none. */
  bannerUrl: string | null;
}

/** A `catalog_media_relation` insert. `created_at` is the database's. */
export interface SeedRelationRow {
  fromId: string;
  toId: string;
  type: MediaRelationType;
}

/**
 * The file this tool writes: one array per target table, so a seeder is a
 * `insert(...).values(file.catalog_media)` and nothing more. Provenance rides
 * along in `report` — useful when a row turns out wrong and the question is
 * which page produced it.
 */
export interface SeedFile {
  generatedAt: string;
  catalog_media: SeedMediaRow[];
  catalog_media_relation: SeedRelationRow[];
  /**
   * `catalog_media.id → provider page URL`, for redirects. Kept out of the rows
   * on purpose: it is derivable from `external_ids` and has no catalog column, so
   * the arrays stay insertable verbatim.
   */
  urls?: Record<string, string>;
  report: {
    sources: Payload['sources'];
    skipped: Payload['skipped'];
    warnings: string[];
  };
}

/* ------------------------------------------------------------------ *
 * HTML helpers
 * ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  middot: '·',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (/^#x/i.test(body)) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? match;
  });
}

/** Tags to spaces, entities decoded, whitespace collapsed onto one line. */
export function oneLine(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Like `oneLine`, but `<br>` becomes a paragraph break (synopsis, background). */
export function prose(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The slice between a heading/opening match and the next match of `end`. */
function sliceBetween(html: string, start: RegExp, end: RegExp): string | null {
  const open = start.exec(html);
  if (!open) return null;
  const rest = html.slice(open.index + open[0].length);
  const close = end.exec(rest);
  return close ? rest.slice(0, close.index) : rest;
}

/**
 * A section heading's own text. MAL injects an "Edit" control *inside* the h2
 * (`<h2><div class="floatRightHeader">…</div>Background</h2>`), and not on every
 * page or every section, so the heading can only be identified after stripping it.
 */
function headingText(inner: string): string {
  return oneLine(inner.replace(/<div class="floatRightHeader">[\s\S]*?<\/div>/, ''));
}

/**
 * The content of `<h2>Name</h2>`, up to the next heading. Heading text is
 * matched rather than markup: the same section is `<h2>Statistics</h2>` on an
 * anime page and `<h2 style="…">…</h2>` on a manga page.
 */
export function section(html: string, name: string): string | null {
  for (const match of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) {
    if (headingText(match[1]!).toLowerCase() !== name.toLowerCase()) continue;
    const rest = html.slice(match.index + match[0].length);
    const next = rest.search(/<h2[\s>]/i);
    return next < 0 ? rest : rest.slice(0, next);
  }
  return null;
}

/**
 * The synopsis paragraph. Anime pages wrap it in a `<p>`, manga pages in a
 * `<span>`, so the closing tag is read off the opening one; the heading
 * boundary is the fallback when MAL leaves the element unbalanced.
 */
export function parseSynopsis(html: string): string | null {
  const open = /<(p|span)[^>]*itemprop="description"[^>]*>/i.exec(html);
  if (!open) return null;
  const rest = html.slice(open.index + open[0].length);
  const close = rest.toLowerCase().indexOf(`</${open[1]!.toLowerCase()}>`);
  if (close >= 0) return prose(rest.slice(0, close));
  const next = rest.search(/<h2[\s>]/i);
  return prose(next < 0 ? rest : rest.slice(0, next));
}

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `Sep 29, 2023` → `2023-09-29`. Returns null for `?` / `Not available`. */
export function parseMalDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!.toLowerCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

/** The `<div class="spaceit_pad"><span class="dark_text">Label:</span>` rows. */
function infoMap(html: string): Map<string, string> {
  const fields = new Map<string, string>();
  const block = section(html, 'Information');
  if (!block) return fields;
  for (const chunk of block.split(/<div class="spaceit_pad"/).slice(1)) {
    const label = /<span class="dark_text">([\s\S]*?)<\/span>/.exec(chunk);
    if (!label) continue;
    const key = oneLine(label[1]!).replace(/:$/, '').trim();
    fields.set(key, chunk.slice(label.index + label[0].length));
  }
  return fields;
}

function linkList(chunk: string): string[] {
  return [...chunk.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map(([, attrs = '', inner = '']) => {
      const title = /title="([^"]+)"/.exec(attrs);
      return oneLine(title ? title[1]! : inner);
    })
    .filter((name) => name.length > 0);
}

/** Same, keeping MAL's `(Story)` / `(Art)` role suffix. */
function personList(chunk: string): string[] {
  return [...chunk.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>(\s*\(([^)]+)\))?/g)]
    .map(([, name = '', , role]) => {
      const clean = oneLine(name);
      return role ? `${clean} (${role.trim()})` : clean;
    })
    .filter((name) => name.length > 0);
}

/** Genre chips, from the hidden `itemprop="genre"` spans MAL emits for SEO. */
function genreList(chunk: string): string[] {
  const fromItems = [...chunk.matchAll(/<span itemprop="genre"[^>]*>([^<]+)<\/span>/g)].map(
    ([, g]) => oneLine(g!),
  );
  const values = fromItems.length > 0 ? fromItems : linkList(chunk);
  return values.filter((value) => value.length > 0);
}

function parseEntryHref(
  href: string,
): { malType: MalPageType; malId: number; slug: string } | null {
  const match = /\/(anime|manga)\/(\d+)(?:\/([^/?#]+))?/.exec(href);
  if (!match) return null;
  return { malType: match[1] as MalPageType, malId: Number(match[2]), slug: match[3] ?? '' };
}

/** `Sequel (TV)` → `{ label: 'Sequel', format: 'TV' }`; `Side Story:` → `{ label: 'Side Story' }`. */
export function splitRelationLabel(raw: string): { label: string; format: string | null } {
  const clean = oneLine(raw).replace(/:$/, '').trim();
  const withFormat = /^(.+?)\s*\(([^)]+)\)$/.exec(clean);
  if (withFormat) return { label: withFormat[1]!.trim(), format: withFormat[2]!.trim() };
  return { label: clean, format: null };
}

/**
 * The tile grid MAL renders above the fold. It is a curated subset — FMA:B's
 * page shows one tile (its manga) and hides three more in the table — so the
 * table is parsed too and the two are merged.
 */
function parseRelationTiles(html: string): MalRelationRef[] {
  const pattern =
    /<div class="entry borderClass[^"]*">[\s\S]*?<div class="relation">([\s\S]*?)<\/div>\s*<div class="title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const refs: MalRelationRef[] = [];
  for (const [, rawLabel = '', href = '', title = ''] of html.matchAll(pattern)) {
    const entry = parseEntryHref(href);
    if (!entry) continue;
    const { label, format } = splitRelationLabel(rawLabel);
    if (!label) continue;
    refs.push({ ...entry, title: oneLine(title), label, format, hidden: false, via: 'tile' });
  }
  return refs;
}

/** The complete list in `<table class="entries-table">`, including `.hide-entry` rows. */
function parseRelationTable(html: string): MalRelationRef[] {
  const table = sliceBetween(
    html,
    /<table[^>]*class="[^"]*entries-table[^"]*"[^>]*>/i,
    /<\/table>/i,
  );
  if (!table) return [];
  const refs: MalRelationRef[] = [];
  for (const [, rowClass = '', row = ''] of table.matchAll(
    /<tr class="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g,
  )) {
    const labelCell = /<td[^>]*>([\s\S]*?)<\/td>/.exec(row);
    if (!labelCell) continue;
    const { label } = splitRelationLabel(labelCell[1]!);
    if (!label) continue;
    const hidden = /hide-entry/.test(rowClass);
    for (const [, href = '', title = '', after = ''] of row.matchAll(
      /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([^<]*)/g,
    )) {
      const entry = parseEntryHref(href);
      if (!entry) continue;
      const formatMatch = /\(([^)]+)\)/.exec(after);
      refs.push({
        ...entry,
        title: oneLine(title),
        label,
        format: formatMatch ? formatMatch[1]!.trim() : null,
        hidden,
        via: 'table',
      });
    }
  }
  return refs;
}

export function parseRelations(html: string): MalRelationRef[] {
  const seen = new Set<string>();
  const refs: MalRelationRef[] = [];
  for (const ref of [...parseRelationTiles(html), ...parseRelationTable(html)]) {
    const key = `${ref.malType}:${ref.malId}:${ref.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

function parseStatistics(html: string) {
  const stats = section(html, 'Statistics') ?? html;
  const score = /<span itemprop="ratingValue"[^>]*>([\d.]+)<\/span>/.exec(stats);
  const rank = /Ranked[^#]{0,60}#(\d+)/.exec(stats);
  const popularity = /Popularity:<\/span>\s*#(\d+)/.exec(stats);
  const members = /Members:<\/span>\s*([\d,]+)/.exec(stats);
  const favorites = /Favorites:<\/span>\s*([\d,]+)/.exec(stats);
  return {
    score: score ? Number(score[1]) : null,
    rank: rank ? Number(rank[1]) : null,
    popularity: popularity ? Number(popularity[1]) : null,
    members: members ? toNumber(members[1]) : null,
    favorites: favorites ? toNumber(favorites[1]) : null,
  };
}

function parseExternalLinks(html: string): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = [];
  // MAL splits these across two blocks: "Available At" (official site, socials)
  // and "Resources" (AniDB, ANN, Wikipedia, Syoboi). The provider ids the catalog
  // keeps live in the second one, so both are read.
  for (const name of ['Available At', 'Resources']) {
    const block = section(html, name);
    if (!block) continue;
    for (const [, href = '', body = ''] of block.matchAll(
      /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    )) {
      const caption = /<div class="caption">([\s\S]*?)<\/div>/.exec(body);
      const label = oneLine(caption ? caption[1]! : '');
      if (!label) continue;
      const url = decodeEntities(href);
      if (links.some((link) => link.url === url)) continue;
      links.push({ name: label, url });
    }
  }
  return links;
}

/** `Fall 2023` → `{ season: 'fall', year: 2023 }`. */
function parsePremiered(value: string | null): { season: string; year: number } | null {
  if (!value) return null;
  const match = /(winter|spring|summer|fall)\s+(\d{4})/i.exec(value);
  if (!match) return null;
  return { season: match[1]!.toLowerCase(), year: Number(match[2]) };
}

/* ------------------------------------------------------------------ *
 * Page parser
 * ------------------------------------------------------------------ */

/**
 * Turn one MAL detail page into a `MalPage`. Pure: no network, no clock, no
 * environment — which is what lets the fixtures pin MAL's markup in tests.
 */
export function parseMalPage(html: string, url: string): MalPage {
  const identity = /https?:\/\/myanimelist\.net\/(anime|manga)\/(\d+)/.exec(url);
  if (!identity) throw new Error(`not a MyAnimeList anime or manga URL: ${url}`);
  const malType = identity[1] as MalPageType;
  const malId = Number(identity[2]);

  const info = infoMap(html);
  const value = (label: string): string | null => {
    const raw = info.get(label);
    return raw === undefined ? null : oneLine(raw);
  };
  const chunk = (label: string): string | null => info.get(label) ?? null;

  const meta = (property: string): string | null => {
    const match = new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`).exec(html);
    return match ? decodeEntities(match[1]!) : null;
  };

  const altTitles = new Map<string, string>();
  const altBlock = section(html, 'Alternative Titles');
  if (altBlock) {
    for (const piece of altBlock.split(/<div class="spaceit_pad"/).slice(1)) {
      const label = /<span class="dark_text">([\s\S]*?)<\/span>/.exec(piece);
      if (!label) continue;
      const key = oneLine(label[1]!).replace(/:$/, '').trim();
      // The value ends at its own `</div>`: the last alt-title row is followed by
      // the "More titles" toggle, which belongs to no row and would otherwise be
      // glued onto that row's title.
      const rest = piece.slice(label.index + label[0].length);
      const close = rest.indexOf('</div>');
      const title = oneLine(close >= 0 ? rest.slice(0, close) : rest);
      if (title) altTitles.set(key, title);
    }
  }

  const airedRaw = value('Aired') ?? value('Published');
  const [airedStartText, airedEndText] = (airedRaw ?? '').split(/\s+to\s+/);
  const premiered = parsePremiered(value('Premiered'));
  const synopsis = parseSynopsis(html);
  const backgroundSection = section(html, 'Background');
  const statistics = parseStatistics(html);

  const englishTitle = /class="title-english[^"]*"[^>]*>([\s\S]*?)</.exec(html);
  const synonyms = (altTitles.get('Synonyms') ?? '')
    .split(/,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    url,
    malId,
    malType,
    titleRomaji: meta('og:title') ?? oneLine(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''),
    titleEnglish: englishTitle
      ? oneLine(englishTitle[1]!)
      : (altTitles.get('English') ?? null) || null,
    titleJapanese: altTitles.get('Japanese') ?? null,
    synonyms,
    format: value('Type'),
    episodes: toNumber(value('Episodes')),
    chapters: toNumber(value('Chapters')),
    volumes: toNumber(value('Volumes')),
    status: value('Status'),
    airedStart: parseMalDate(airedStartText),
    airedEnd: parseMalDate(airedEndText),
    premiered,
    broadcast: value('Broadcast'),
    source: value('Source'),
    duration: value('Duration'),
    rating: value('Rating'),
    genres: genreList(chunk('Genres') ?? ''),
    demographics: genreList(chunk('Demographic') ?? chunk('Demographics') ?? ''),
    studios: linkList(chunk('Studios') ?? ''),
    producers: linkList(chunk('Producers') ?? ''),
    licensors: linkList(chunk('Licensors') ?? ''),
    serialization: linkList(chunk('Serialization') ?? ''),
    authors: personList(chunk('Authors') ?? ''),
    ...statistics,
    synopsis,
    background: backgroundSection ? prose(backgroundSection) : null,
    coverUrl: meta('og:image'),
    externalLinks: parseExternalLinks(html),
    relations: parseRelations(html),
  };
}

/* ------------------------------------------------------------------ *
 * MAL → catalog mapping
 * ------------------------------------------------------------------ */

const ANIME_FORMATS = new Set(['tv', 'movie', 'ona', 'ova', 'special', 'tv special']);
const MANGA_FORMATS = new Set(['manga', 'manhua']);

export interface KindDecision {
  kind: MediaKind | null;
  reason?: string;
  warning?: string;
}

/**
 * MAL `Type` → Trackt kind. Skipping beats guessing: a light novel or a music
 * video is not a work this catalog tracks, and minting a `manga` row for it
 * would be a permanent, un-deletable mistake.
 *
 * Anime films stay `anime` rather than `movie` on purpose: their identity
 * provider is AniList, while `movie` rows are keyed on TMDB (ADR-0001).
 */
export function mapKind(malType: MalPageType, format: string | null): KindDecision {
  const normalized = (format ?? '').toLowerCase().trim();
  if (!normalized) {
    return {
      kind: malType === 'anime' ? 'anime' : 'manga',
      warning: 'no Type field; assumed kind',
    };
  }
  if (malType === 'anime') {
    if (ANIME_FORMATS.has(normalized)) {
      return normalized === 'movie'
        ? {
            kind: 'anime',
            warning: 'anime film kept as kind=anime so the AniList id stays canonical',
          }
        : { kind: 'anime' };
    }
    return {
      kind: null,
      reason: `MAL type '${format}' is not a trackable work (music video, CM, PV)`,
    };
  }
  if (normalized === 'manhwa') {
    return {
      kind: 'webtoon',
      warning:
        'webtoons have no identity provider, so no canonical id: the row cannot be published',
    };
  }
  if (MANGA_FORMATS.has(normalized)) return { kind: 'manga' };
  return { kind: null, reason: `MAL type '${format}' is not a manga (novel, one-shot, doujin)` };
}

const STATUS_BY_MAL: Record<string, MediaStatus> = {
  'finished airing': 'ended',
  finished: 'ended',
  'currently airing': 'airing',
  publishing: 'publishing',
  discontinued: 'cancelled',
  'not yet aired': 'announced',
  'not yet published': 'announced',
};

/** `On Hiatus` is a publishing manga and an airing anime — the kind breaks the tie. */
export function mapStatus(status: string | null, kind: MediaKind): MediaStatus | null {
  if (!status) return null;
  const normalized = status.toLowerCase().trim().replace(/\s+/g, ' ');
  if (normalized === 'on hiatus') return kind === 'anime' ? 'airing' : 'publishing';
  return STATUS_BY_MAL[normalized] ?? null;
}

/**
 * MAL's genre chips mix in tags this catalog does not treat as genres
 * (`Award Winning`, `Gore`) and spell some differently from TMDB, which is the
 * source the instance-side genre-overlap heuristic compares against.
 */
const GENRE_ALIASES: Record<string, string> = {
  'sci-fi': 'science fiction',
  scifi: 'science fiction',
  supernatural: 'supernatural',
};
const GENRE_DENYLIST = new Set(['award winning']);

export function normalizeGenres(genres: string[]): string[] {
  const out: string[] = [];
  for (const genre of genres) {
    const key = genre.toLowerCase().trim().replace(/\s+/g, ' ');
    if (key === '' || GENRE_DENYLIST.has(key)) continue;
    const normalized = GENRE_ALIASES[key] ?? key;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** MAL's `Sequel`/`Prequel`/… vocabulary → the four stored types, as an edge plan. */
export type RelationRule =
  | { action: 'edge'; type: MediaRelationType; direction: 'forward' | 'reverse' }
  | { action: 'kind-dependent'; type: 'adaptation' }
  | { action: 'skip'; reason: string };

/**
 * One row per MAL label. `forward` means this page's work is the edge's `from`.
 * `Parent Story` maps to a reversed `spinoff` because that is exactly what the
 * reverse label `parent` means (ADR-0004) — a side story's parent is not its
 * prequel, which is what a reversed `sequel` would claim.
 */
export const RELATION_RULES: Record<string, RelationRule> = {
  sequel: { action: 'edge', type: 'sequel', direction: 'forward' },
  prequel: { action: 'edge', type: 'sequel', direction: 'reverse' },
  'side story': { action: 'edge', type: 'spinoff', direction: 'forward' },
  'spin-off': { action: 'edge', type: 'spinoff', direction: 'forward' },
  'parent story': { action: 'edge', type: 'spinoff', direction: 'reverse' },
  adaptation: { action: 'kind-dependent', type: 'adaptation' },
  'alternative setting': { action: 'edge', type: 'related', direction: 'forward' },
  'alternative version': { action: 'edge', type: 'related', direction: 'forward' },
  summary: { action: 'edge', type: 'related', direction: 'forward' },
  'full story': { action: 'edge', type: 'related', direction: 'forward' },
  character: { action: 'skip', reason: 'character compilation, not a related work' },
  other: { action: 'skip', reason: 'music videos and ads are filed under Other by the providers' },
};

const IS_PRINT = new Set<MediaKind>(['manga', 'webtoon']);
const IS_SCREEN = new Set<MediaKind>(['anime', 'series', 'movie']);

/**
 * MAL labels `Adaptation` from both sides, so the direction is decided by kind,
 * not by which page was scraped: the print work is always the `from`, the screen
 * work the `to`. Two same-medium entries are ambiguous and are dropped.
 */
export function planAdaptation(
  sourceKind: MediaKind,
  targetKind: MediaKind,
): { direction: 'forward' | 'reverse' } | { reason: string } {
  if (IS_PRINT.has(sourceKind) && IS_SCREEN.has(targetKind)) return { direction: 'forward' };
  if (IS_SCREEN.has(sourceKind) && IS_PRINT.has(targetKind)) return { direction: 'reverse' };
  return { reason: `adaptation between ${sourceKind} and ${targetKind} has no defined direction` };
}

/** `Sousou no Frieren 2nd Season` → 2. A hint only; `--season` wins. */
export function inferSeasonNumber(title: string): number | null {
  const ordinal = /(\d+)(?:st|nd|rd|th)\s+Season/i.exec(title);
  if (ordinal) return Number(ordinal[1]);
  const numbered = /\bSeason\s+(\d+)\b/i.exec(title);
  if (numbered) return Number(numbered[1]);
  return null;
}

export interface BuildOptions {
  kindOverride?: MediaKind;
  seasonOverride?: number;
  withDescription?: boolean;
  withCover?: boolean;
  /** Extra MAL labels to keep, e.g. `{ other: 'related' }`. */
  relationOverrides?: Record<string, MediaRelationType>;
}

export function buildWork(
  page: MalPage,
  options: BuildOptions = {},
): ScrapedWork | { skipped: string } {
  const warnings: string[] = [];
  const decision = mapKind(page.malType, page.format);
  if (decision.warning) warnings.push(decision.warning);
  const kind = options.kindOverride ?? decision.kind;
  if (!kind) return { skipped: decision.reason ?? 'unsupported MAL type' };

  const title = page.titleEnglish ?? page.titleRomaji;
  if (!title) return { skipped: 'page states no title' };

  const synonyms: string[] = [];
  for (const candidate of [page.titleRomaji, page.titleJapanese, ...page.synonyms]) {
    const clean = candidate?.trim();
    if (clean && clean !== title && !synonyms.includes(clean)) synonyms.push(clean);
  }

  const hintedSeason = inferSeasonNumber(`${page.titleRomaji} ${page.titleEnglish ?? ''}`);
  let seasonNumber: number | null = null;
  if (kind === 'anime' || kind === 'series') {
    if (options.seasonOverride !== undefined) {
      seasonNumber = options.seasonOverride;
    } else if (hintedSeason !== null) {
      seasonNumber = hintedSeason;
      warnings.push(`seasonNumber ${hintedSeason} inferred from the title; verify it`);
    } else {
      seasonNumber = 1;
      if (page.relations.some((ref) => /^(sequel|prequel)$/i.test(ref.label))) {
        warnings.push(
          'seasonNumber defaulted to 1 although the page lists a sequel/prequel — pass --season',
        );
      }
    }
  }

  const status = mapStatus(page.status, kind) ?? undefined;
  if (status === undefined) warnings.push(`unmapped MAL status '${page.status ?? 'none'}'`);

  const externalIds: Record<string, string | number> = { mal: page.malId };
  for (const link of page.externalLinks) {
    const name = link.name.toLowerCase();
    if (name === 'anidb') {
      const id = /aid=(\d+)/.exec(link.url);
      if (id) externalIds.anidb = Number(id[1]);
    }
    if (name === 'ann') {
      const id = /[?&]id=(\d+)/.exec(link.url);
      if (id) externalIds.ann = Number(id[1]);
    }
  }

  const partCount =
    kind === 'anime' || kind === 'series' ? (page.episodes ?? null) : (page.chapters ?? null);

  const media: DraftMedia = {
    id: null,
    kind,
    title,
    synonyms,
    year:
      (page.airedStart ? Number(page.airedStart.slice(0, 4)) : null) ??
      page.premiered?.year ??
      null,
    status: status ?? null,
    // Demographics (`Shounen`) stay in the raw page: as a genre they would make
    // every shounen series "related" to every other one by genre overlap.
    genres: normalizeGenres(page.genres),
    partCount,
    seasonNumber,
    externalIds,
    description: options.withDescription ? (page.synopsis ?? null) : null,
    coverUrl: options.withCover ? (page.coverUrl ?? null) : null,
    // MAL has no banner: its page's og:image is the poster. `applyAniList`
    // backfills this when the MAL-ranked walk resolves the work on AniList.
    bannerUrl: null,
  };

  const relations: PlannedRelation[] = [];
  const skippedRelations: ScrapedWork['skippedRelations'] = [];
  for (const ref of page.relations) {
    const key = ref.label.toLowerCase().trim();
    const override = options.relationOverrides?.[key];
    const rule: RelationRule = override
      ? { action: 'edge', type: override, direction: 'forward' }
      : (RELATION_RULES[key] ?? { action: 'skip', reason: `unknown MAL relation '${ref.label}'` });

    const targetKind = options.kindOverride ? kind : mapKind(ref.malType, ref.format).kind;
    if (!targetKind) {
      skippedRelations.push({
        label: ref.label,
        target: ref.title,
        targetMalId: ref.malId,
        reason: 'target kind unsupported',
      });
      continue;
    }
    if (rule.action === 'skip') {
      skippedRelations.push({
        label: ref.label,
        target: ref.title,
        targetMalId: ref.malId,
        reason: rule.reason,
      });
      continue;
    }
    if (rule.action === 'kind-dependent') {
      const planned = planAdaptation(kind, targetKind);
      if ('reason' in planned) {
        skippedRelations.push({
          label: ref.label,
          target: ref.title,
          targetMalId: ref.malId,
          reason: planned.reason,
        });
        continue;
      }
      relations.push({
        type: 'adaptation',
        direction: planned.direction,
        target: ref,
        source: page,
      });
      continue;
    }
    relations.push({ type: rule.type, direction: rule.direction, target: ref, source: page });
  }

  return { page, media, relations, skippedRelations, warnings };
}

/* ------------------------------------------------------------------ *
 * Canonical ids
 * ------------------------------------------------------------------ */

/** RFC 4122 UUIDv5 over the catalog namespace. Same output as `uuidv5` in @trackt/shared. */
export function uuidv5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The work's public page at its identity provider — the link a client can send
 * someone to, and the one place a provider's URL shape is encoded. Null when the
 * work has no provider (a webtoon) or the row does not carry the provider id.
 */
export function providerUrl(
  kind: MediaKind,
  externalIds: Record<string, string | number>,
): string | null {
  const provider = IDENTITY_PROVIDER_BY_KIND[kind];
  const externalId = provider ? externalIds[provider] : undefined;
  if (!provider || externalId === undefined) return null;
  if (provider === 'anilist')
    return `https://anilist.co/${kind === 'manga' ? 'manga' : 'anime'}/${externalId}`;
  if (provider === 'tmdb')
    return `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${externalId}`;
  return null;
}

/** `provider:kind:externalId`, frozen by ADR-0001. */
export function canonicalMediaKey(provider: string, kind: MediaKind, externalId: string | number) {
  return `${provider}:${kind}:${externalId}`;
}

export function canonicalMediaId(
  kind: MediaKind,
  externalId: string | number,
  provider?: string,
): string {
  const resolved = provider ?? IDENTITY_PROVIDER_BY_KIND[kind];
  if (!resolved) throw new Error(`media kind '${kind}' has no identity provider`);
  return uuidv5(TRACKT_CATALOG_NAMESPACE, canonicalMediaKey(resolved, kind, externalId));
}

/* ------------------------------------------------------------------ *
 * AniList identity resolution
 * ------------------------------------------------------------------ */

export interface AniListRecord {
  id: number;
  idMal: number | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[];
  genres?: string[];
  episodes?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  status?: string | null;
  seasonYear?: number | null;
  coverImage?: { large?: string | null };
  bannerImage?: string | null;
}

const ANILIST_FIELDS = `id idMal title { romaji english native } synonyms genres episodes chapters volumes status seasonYear coverImage { large } bannerImage`;

const ANILIST_STATUS: Record<string, MediaStatus> = {
  RELEASING: 'airing',
  FINISHED: 'ended',
  NOT_YET_RELEASED: 'announced',
  CANCELLED: 'cancelled',
};

export interface AniListOptions {
  fetchImpl?: typeof fetch;
  batchSize?: number;
  delayMs?: number;
  /** Attempts per query for 429/5xx before giving up. */
  retries?: number;
  /** Minimum gap between requests; defaults to `delayMs` with a 2 s floor. */
  spacingMs?: number;
  onWarn?: (message: string) => void;
}

/**
 * Resolve `(malType, malId)` → AniList record with one aliased GraphQL query per
 * batch. AniList is the identity provider for anime and manga, so this is the
 * step that turns a scraped page into a publishable row.
 */
export async function resolveAniList(
  refs: { malType: MalPageType; malId: number }[],
  options: AniListOptions = {},
): Promise<Map<string, AniListRecord>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const batchSize = options.batchSize ?? 20;
  // AniList allows 90 requests a minute and degrades to 30 under load; two
  // seconds between calls keeps a long bulk run under the degraded limit.
  const requestedDelay = options.delayMs ?? 2000;
  const spacingMs = options.spacingMs ?? Math.max(requestedDelay, 2000);
  const retries = options.retries ?? 2;
  const onWarn = options.onWarn ?? (() => {});

  const wanted = [...new Map(refs.map((ref) => [`${ref.malType}:${ref.malId}`, ref])).values()];
  const found = new Map<string, AniListRecord>();
  const keyOf = (ref: { malType: MalPageType; malId: number }) => `${ref.malType}:${ref.malId}`;
  const typeOf = (ref: { malType: MalPageType }) => (ref.malType === 'anime' ? 'ANIME' : 'MANGA');

  // One clock for every request, including the recursive splits below.
  let lastCall = 0;
  const throttle = async () => {
    const wait = spacingMs - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
  };

  /** `Retry-After` when present, else when the window resets, else a backoff. */
  const cooldown = (response: Response, attempt: number): number => {
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 300) * 1000;
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) {
      return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 300_000);
    }
    return Math.min(requestedDelay * (attempt + 2) * 2, 300_000);
  };

  const ask = async (
    batch: { malType: MalPageType; malId: number }[],
    allowFlip = true,
  ): Promise<Map<string, AniListRecord>> => {
    const records = new Map<string, AniListRecord>();
    if (batch.length === 0) return records;
    const fields = batch
      .map(
        (ref, index) =>
          `a${index}: Media(idMal: ${ref.malId}, type: ${typeOf(ref)}) { ${ANILIST_FIELDS} }`,
      )
      .join('\n');

    let throttled = 0;
    for (;;) {
      await throttle();
      const response = await fetchImpl('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: `query {\n${fields}\n}` }),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          data?: Record<string, AniListRecord | null>;
          errors?: { message: string }[];
        };
        if (body.errors?.length) {
          onWarn(`AniList: ${body.errors.map((error) => error.message).join('; ')}`);
        }
        for (const [index, ref] of batch.entries()) {
          const record = body.data?.[`a${index}`];
          if (record) records.set(keyOf(ref), record);
          else onWarn(`AniList has no entry for MAL ${ref.malType} ${ref.malId}`);
        }
        return records;
      }

      if (response.status === 429 && throttled < 4) {
        throttled++;
        const wait = cooldown(response, throttled);
        onWarn(`AniList rate limit: waiting ${Math.round(wait / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (response.status >= 500 && throttled < retries) {
        throttled++;
        await new Promise((resolve) => setTimeout(resolve, cooldown(response, throttled)));
        continue;
      }

      if (response.status === 404) {
        // AniList answers 404 for the WHOLE query when one `idMal` in it is
        // unknown, and names the offending alias by line. Dropping that one is far
        // cheaper than bisecting — with a batch of unknown doujin ids, bisection
        // exhausts the rate limit in minutes.
        const body = (await response.json().catch(() => null)) as {
          errors?: { locations?: { line?: number }[] }[];
        } | null;
        const line = body?.errors?.[0]?.locations?.[0]?.line;
        const culpritIndex = typeof line === 'number' ? line - 2 : -1;
        const culprit = batch[culpritIndex];

        // Only when something is left to retry: a one-entry batch has no sibling
        // to drop, and re-entering this branch with it would loop forever.
        if (culprit && batch.length > 1) {
          const rest = batch.filter((_, index) => index !== culpritIndex);
          const [restRecords, culpritRecords] = [
            await ask(rest, allowFlip),
            await ask([culprit], allowFlip),
          ];
          for (const [key, record] of [...restRecords, ...culpritRecords]) {
            records.set(key, record);
          }
          return records;
        }

        if (batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          const [left, right] = [
            await ask(batch.slice(0, middle), allowFlip),
            await ask(batch.slice(middle), allowFlip),
          ];
          for (const [key, record] of [...left, ...right]) records.set(key, record);
          return records;
        }

        const only = batch[0]!;
        // A relation target filed under the wrong medium (MAL lists a light novel
        // on /manga/, AniList may hold it as anime) is worth one guess.
        if (allowFlip) {
          const flipped = {
            malType: only.malType === 'anime' ? ('manga' as const) : ('anime' as const),
            malId: only.malId,
          };
          const recovered = await ask([flipped], false);
          const record = recovered.get(keyOf(flipped));
          if (record) {
            records.set(keyOf(only), record);
            return records;
          }
        }
        onWarn(`AniList has no entry for MAL ${only.malType} ${only.malId}`);
        return records;
      }

      const text = (await response.text()).slice(0, 200);
      throw new Error(`AniList ${response.status}: ${text}`);
    }
  };

  for (let offset = 0; offset < wanted.length; offset += batchSize) {
    for (const [key, record] of await ask(wanted.slice(offset, offset + batchSize))) {
      found.set(key, record);
    }
  }
  return found;
}

/** Apply AniList's identity and fill MAL's gaps, keeping MAL as the primary source. */
export function applyAniList(work: ScrapedWork, record: AniListRecord): void {
  const { media } = work;
  media.externalIds.anilist = record.id;
  if (IDENTITY_PROVIDER_BY_KIND[media.kind]) {
    media.id = canonicalMediaId(media.kind, record.id);
  }

  for (const synonym of [record.title.romaji, record.title.native, ...(record.synonyms ?? [])]) {
    const clean = synonym?.trim();
    if (clean && clean !== media.title && !media.synonyms.includes(clean))
      media.synonyms.push(clean);
  }
  media.genres = normalizeGenres([...media.genres, ...(record.genres ?? [])]);

  const aniListCount = media.kind === 'anime' ? record.episodes : record.chapters;
  if (media.partCount === null && aniListCount != null) media.partCount = aniListCount;
  if (media.partCount !== null && aniListCount != null && media.partCount !== aniListCount) {
    work.warnings.push(
      `partCount differs: MAL ${media.partCount}, AniList ${aniListCount} — the MAL value was kept`,
    );
  }
  if (media.year === null) media.year = record.seasonYear ?? null;
  if (media.status === null) media.status = ANILIST_STATUS[record.status ?? ''] ?? null;
  // MAL's og:image is a poster, so AniList is the only source of a banner.
  if (media.bannerUrl === null) media.bannerUrl = record.bannerImage ?? null;
}

/* ------------------------------------------------------------------ *
 * Payload assembly
 * ------------------------------------------------------------------ */

export interface AssembleOptions {
  anilist?: Map<string, AniListRecord>;
  withDescription?: boolean;
  now?: Date;
}

/**
 * Collapse works into one idempotent publish batch: rows deduped by canonical
 * id, edges deduped by `(from, to, type)` and normalised so a symmetric
 * `related` edge is stored once regardless of which page produced it.
 */
export function assemblePayload(works: ScrapedWork[], options: AssembleOptions = {}): Payload {
  const media = new Map<string, DraftMedia>();
  const skipped: Payload['skipped'] = [];
  const warnings: string[] = [];

  for (const work of works) {
    warnings.push(...work.warnings);
    if (options.anilist) {
      const record = options.anilist.get(`${work.page.malType}:${work.page.malId}`);
      if (record) applyAniList(work, record);
      else warnings.push(`no AniList entry for ${work.page.titleRomaji}; row has no canonical id`);
    }
    if (work.media.id) media.set(work.media.id, work.media);
    else
      skipped.push({ malId: work.page.malId, title: work.media.title, reason: 'no canonical id' });

    // Per-page refusals travel with the batch: a label the mapper declined to
    // translate is the one thing a reviewer most needs to see before publishing.
    for (const entry of work.skippedRelations) {
      skipped.push({
        malId: entry.targetMalId,
        title: `${entry.label}: ${entry.target}`,
        reason: entry.reason,
      });
    }
  }

  const kindOf = new Map<string, MediaKind>();
  for (const [id, row] of media) kindOf.set(id, row.kind);

  const relations: Payload['relations'] = [];
  const seen = new Set<string>();
  for (const work of works) {
    const sourceId = work.media.id;
    if (!sourceId) continue;
    for (const planned of work.relations) {
      const targetKey = `${planned.target.malType}:${planned.target.malId}`;
      const targetRecord = options.anilist?.get(targetKey);
      if (!targetRecord) {
        skipped.push({
          malId: planned.target.malId,
          title: planned.target.title,
          reason: `relation target unresolved (${planned.type} edge from ${work.media.title})`,
        });
        continue;
      }
      const targetDecision = mapKind(planned.target.malType, planned.target.format);
      const targetKind = targetDecision.kind;
      if (!targetKind) {
        skipped.push({
          malId: planned.target.malId,
          title: planned.target.title,
          reason: targetDecision.reason ?? 'unsupported target kind',
        });
        continue;
      }
      // A webtoon target is a real work but has no identity provider, so it has no
      // canonical id to point an edge at (ADR-0001). Skip it, loudly.
      if (!IDENTITY_PROVIDER_BY_KIND[targetKind]) {
        skipped.push({
          malId: planned.target.malId,
          title: planned.target.title,
          reason: `relation target is a ${targetKind}, which has no canonical identity`,
        });
        continue;
      }
      const targetId = canonicalMediaId(targetKind, targetRecord.id);
      let fromId = planned.direction === 'forward' ? sourceId : targetId;
      let toId = planned.direction === 'forward' ? targetId : sourceId;
      if (fromId === toId) continue;
      if (planned.type === 'related' && fromId > toId) [fromId, toId] = [toId, fromId];

      const key = `${fromId}:${toId}:${planned.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fromKind =
        kindOf.get(fromId) ?? (planned.direction === 'forward' ? work.media.kind : targetKind);
      const toKind =
        kindOf.get(toId) ?? (planned.direction === 'forward' ? targetKind : work.media.kind);
      relations.push({
        fromId,
        toId,
        type: planned.type,
        from: {
          malId: planned.direction === 'forward' ? work.page.malId : planned.target.malId,
          kind: fromKind,
          title: planned.direction === 'forward' ? work.media.title : planned.target.title,
        },
        to: {
          malId: planned.direction === 'forward' ? planned.target.malId : work.page.malId,
          kind: toKind,
          title: planned.direction === 'forward' ? planned.target.title : work.media.title,
        },
      });
    }
  }

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    sources: works.map((work) => ({
      url: work.page.url,
      malId: work.page.malId,
      malType: work.page.malType,
      title: work.media.title,
    })),
    media: [...media.values()],
    relations: relations.sort((a, b) => a.fromId.localeCompare(b.fromId)),
    skipped,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Seed file
 * ------------------------------------------------------------------ */

const relationKey = (row: SeedRelationRow) => `${row.fromId}:${row.toId}:${row.type}`;

/** Project the publish payload onto the two catalog tables. */
export function toSeedFile(payload: Payload): SeedFile {
  return {
    generatedAt: payload.generatedAt,
    catalog_media: payload.media
      .filter((row): row is DraftMedia & { id: string } => row.id !== null)
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        synonyms: row.synonyms,
        year: row.year,
        status: row.status,
        genres: row.genres,
        partCount: row.partCount,
        seasonNumber: row.seasonNumber,
        externalIds: row.externalIds,
        description: row.description,
        coverUrl: row.coverUrl,
        bannerUrl: row.bannerUrl,
      })),
    catalog_media_relation: payload.relations.map((edge) => ({
      fromId: edge.fromId,
      toId: edge.toId,
      type: edge.type,
    })),
    urls: Object.fromEntries(
      payload.media
        .map((row) => [row.id, row.id ? providerUrl(row.kind, row.externalIds) : null] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
    ),
    report: {
      sources: payload.sources,
      skipped: payload.skipped,
      warnings: payload.warnings,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Seed file I/O
 * ------------------------------------------------------------------ */

/**
 * Fold a fresh run into an existing seed file: rows and edges keyed the way the
 * tables key them, so scraping page after page accumulates one file instead of
 * overwriting it. A later run wins for a row it scraped again.
 */
export function mergeSeedFiles(base: SeedFile | null, next: SeedFile): SeedFile {
  if (!base) return next;
  const media = new Map(base.catalog_media.map((row) => [row.id, row]));
  for (const row of next.catalog_media) media.set(row.id, row);
  const relations = new Map(base.catalog_media_relation.map((row) => [relationKey(row), row]));
  for (const row of next.catalog_media_relation) relations.set(relationKey(row), row);
  const urls = { ...base.urls, ...next.urls };
  const unique = <T>(items: T[], key: (item: T) => string) => {
    const seen = new Set<string>();
    return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
  };
  return {
    generatedAt: next.generatedAt,
    catalog_media: [...media.values()],
    catalog_media_relation: [...relations.values()],
    urls,
    report: {
      sources: unique([...base.report.sources, ...next.report.sources], (row) => row.url),
      skipped: unique(
        [...base.report.skipped, ...next.report.skipped],
        (row) => `${row.malId}:${row.reason}`,
      ),
      warnings: unique([...base.report.warnings, ...next.report.warnings], (row) => row),
    },
  };
}

/** A seed file on disk, or null when there is not one yet. */
export async function readSeedFile(path: string): Promise<SeedFile | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`cannot read seed file ${path}: ${(error as Error).message}`);
  }
  const parsed = JSON.parse(raw) as Partial<SeedFile>;
  return {
    generatedAt: parsed.generatedAt ?? new Date(0).toISOString(),
    catalog_media: parsed.catalog_media ?? [],
    catalog_media_relation: parsed.catalog_media_relation ?? [],
    urls: parsed.urls ?? {},
    report: {
      sources: parsed.report?.sources ?? [],
      skipped: parsed.report?.skipped ?? [],
      warnings: parsed.report?.warnings ?? [],
    },
  };
}

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */

export interface PublishOptions {
  catalogUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
}

export interface PublishResult {
  media: { id: string; created: boolean; seq: number }[];
  relations: { fromId: string; toId: string; type: string; created: boolean }[];
  failures: string[];
}

/**
 * POST the batch to the catalog's admin surface: media first (relations 404 on
 * an unknown endpoint), then edges. Rows are idempotent upserts on the catalog
 * side, so a re-run is safe.
 */
export async function publishPayload(
  payload: Payload,
  options: PublishOptions,
): Promise<PublishResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.catalogUrl.replace(/\/+$/, '');
  const post = async (path: string, body: unknown) => {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${path} → ${response.status} ${text.slice(0, 400)}`);
    }
    return response.json();
  };

  const result: PublishResult = { media: [], relations: [], failures: [] };
  for (const row of payload.media) {
    if (!row.id) {
      result.failures.push(`${row.title}: no canonical id`);
      continue;
    }
    try {
      const body = (await post('/v1/admin/media', row)) as { created: boolean; seq: number };
      result.media.push({ id: row.id, created: body.created, seq: body.seq });
      options.onProgress?.(
        `media ${row.title}: ${body.created ? 'created' : 'updated'} seq ${body.seq}`,
      );
    } catch (error) {
      result.failures.push(`${row.title}: ${(error as Error).message}`);
    }
  }
  for (const edge of payload.relations) {
    try {
      const body = (await post('/v1/admin/relations', {
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
      })) as { created: boolean };
      result.relations.push({ ...edge, created: body.created });
      options.onProgress?.(
        `relation ${edge.type} ${edge.from?.title ?? edge.fromId} → ${edge.to?.title ?? edge.toId}: ${
          body.created ? 'created' : 'exists'
        }`,
      );
    } catch (error) {
      result.failures.push(
        `relation ${edge.fromId}→${edge.toId} ${edge.type}: ${(error as Error).message}`,
      );
    }
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

export interface FetchOptions {
  userAgent?: string;
  delayMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_USER_AGENT =
  'trackt-catalog-scraper/0.1 (+https://github.com/pvrnn/Trackt; one request at a time)';

/** One detail page, politely: a delay between calls and a retry on 429/5xx. */
export async function fetchMalPage(url: string, options: FetchOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 1500;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
      redirect: 'follow',
    });
    if (response.ok) return response.text();
    lastError = new Error(`MAL ${response.status} for ${url}`);
    if (response.status !== 429 && response.status < 500) break;
  }
  throw lastError ?? new Error(`failed to fetch ${url}`);
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const HELP = `Scrape MyAnimeList detail pages into Trackt catalog payloads.

Usage:
  node scripts/mal-scrape/scrape.ts <mal-url|id>... [options]

Inputs:
  https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood
  5114 --type anime            (bare id needs --type)

Catalog mapping:
  --anilist                    resolve AniList ids and derive canonical ids
                               (required for publishable output)
  --kind <kind>                override the mapped kind (movie|series|anime|manga|webtoon)
  --season <n>                 override seasonNumber (default: title hint, else 1)
  --with-description           include MAL's synopsis (default: null — MAL-authored text)
  --with-cover                 include the MAL CDN cover (default: null — licensed art)
  --map <label=type,...>       override relation mapping, e.g. summary=related
                               labels: ${Object.keys(RELATION_RULES).join(', ')}
                               types:  ${MEDIA_RELATION_TYPES.join(', ')}

Output:
  --out <file>                 write the seed JSON here (default: stdout)
  --merge <file>               fold this run into an existing seed file
  --publish                    POST rows to the catalog via /v1/admin/*
  --catalog-url <url>          default $CATALOG_URL
  --token <token>              default $CATALOG_ADMIN_TOKEN

Politeness:
  --delay <ms>                 delay between MAL requests (default 1500)
  --user-agent <ua>            override the identifying User-Agent

  --self-test                  assert the frozen reference ids and exit
  --help                       this text
`;

interface CliOptions {
  inputs: string[];
  type?: MalPageType;
  anilist: boolean;
  kind?: MediaKind;
  season?: number;
  withDescription: boolean;
  withCover: boolean;
  relationOverrides: Record<string, MediaRelationType>;
  out?: string;
  merge?: string;
  publish: boolean;
  catalogUrl?: string;
  token?: string;
  delayMs: number;
  userAgent?: string;
  selfTest: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputs: [],
    anilist: false,
    withDescription: false,
    withCover: false,
    relationOverrides: {},
    publish: false,
    delayMs: 1500,
    selfTest: false,
    help: false,
  };
  const boolean = new Set([
    '--anilist',
    '--with-description',
    '--with-cover',
    '--publish',
    '--self-test',
    '--help',
  ]);
  const aliases: Record<string, string> = {
    '--type': 'type',
    '--kind': 'kind',
    '--season': 'season',
    '--map': 'map',
    '--out': 'out',
    '--merge': 'merge',
    '--catalog-url': 'catalogUrl',
    '--token': 'token',
    '--delay': 'delayMs',
    '--user-agent': 'userAgent',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (boolean.has(arg)) {
      if (arg === '--anilist') options.anilist = true;
      if (arg === '--with-description') options.withDescription = true;
      if (arg === '--with-cover') options.withCover = true;
      if (arg === '--publish') options.publish = true;
      if (arg === '--self-test') options.selfTest = true;
      if (arg === '--help') options.help = true;
      continue;
    }
    const alias = aliases[arg];
    if (!alias) {
      if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
      options.inputs.push(arg);
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    switch (alias) {
      case 'type':
        if (value !== 'anime' && value !== 'manga')
          throw new Error(`--type must be anime or manga`);
        options.type = value;
        break;
      case 'kind':
        if (!(MEDIA_KINDS as readonly string[]).includes(value)) {
          throw new Error(`--kind must be one of ${MEDIA_KINDS.join(', ')}`);
        }
        options.kind = value as MediaKind;
        break;
      case 'season':
        options.season = Number(value);
        if (!Number.isInteger(options.season)) throw new Error('--season must be an integer');
        break;
      case 'map':
        for (const pair of value.split(',')) {
          const [label, type] = pair.split('=').map((part) => part.trim());
          if (!label || !type) throw new Error(`--map expects label=type, got '${pair}'`);
          if (!(MEDIA_RELATION_TYPES as readonly string[]).includes(type)) {
            throw new Error(`--map type must be one of ${MEDIA_RELATION_TYPES.join(', ')}`);
          }
          options.relationOverrides[label.toLowerCase()] = type as MediaRelationType;
        }
        break;
      case 'out':
        options.out = value;
        break;
      case 'merge':
        options.merge = value;
        break;
      case 'catalogUrl':
        options.catalogUrl = value;
        break;
      case 'token':
        options.token = value;
        break;
      case 'delayMs':
        options.delayMs = Number(value);
        if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
          throw new Error('--delay must be a non-negative number of milliseconds');
        }
        break;
      case 'userAgent':
        options.userAgent = value;
        break;
    }
  }
  return options;
}

/** The frozen ids from packages/shared/test/canonical-id.test.ts. */
export const REFERENCE_VECTORS: { kind: MediaKind; externalId: number; id: string }[] = [
  { kind: 'movie', externalId: 603, id: '2e1c929b-ab13-5b76-9706-c68e438b6a03' },
  { kind: 'anime', externalId: 1, id: 'ab89c239-b251-51e5-b339-3c8c3904f52b' },
];

export function selfTest(): void {
  for (const vector of REFERENCE_VECTORS) {
    const actual = canonicalMediaId(vector.kind, vector.externalId);
    if (actual !== vector.id) {
      throw new Error(
        `canonical id drift: ${vector.kind}:${vector.externalId} derived ${actual}, expected ${vector.id}`,
      );
    }
  }
  if (
    uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com') !==
    '2ed6657d-e927-568b-95e1-2665a8aea6a2'
  ) {
    throw new Error('uuidv5 does not match the RFC 4122 reference vector');
  }
}

export function toUrl(input: string, type?: MalPageType): string {
  if (/^\d+$/.test(input)) {
    if (!type) throw new Error(`bare id ${input} needs --type anime|manga`);
    return `https://myanimelist.net/${type}/${input}`;
  }
  if (!/^https?:\/\/(www\.)?myanimelist\.net\/(anime|manga)\/\d+/.test(input)) {
    throw new Error(`not a MyAnimeList anime or manga URL: ${input}`);
  }
  return input;
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.selfTest) {
    selfTest();
    process.stdout.write('canonical-id reference vectors OK\n');
    return 0;
  }
  if (options.inputs.length === 0) throw new Error('no input pages; see --help');

  const urls = options.inputs.map((input) => toUrl(input, options.type));
  const pages: MalPage[] = [];
  for (const [index, url] of urls.entries()) {
    if (index > 0 && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    process.stderr.write(`fetching ${url}\n`);
    const html = await fetchMalPage(url, {
      delayMs: options.delayMs,
      userAgent: options.userAgent,
    });
    pages.push(parseMalPage(html, url));
  }

  const works: ScrapedWork[] = [];
  const skipped: Payload['skipped'] = [];
  for (const page of pages) {
    const built = buildWork(page, {
      kindOverride: options.kind,
      seasonOverride: options.season,
      withDescription: options.withDescription,
      withCover: options.withCover,
      relationOverrides: options.relationOverrides,
    });
    if ('skipped' in built) {
      skipped.push({ malId: page.malId, title: page.titleRomaji, reason: built.skipped });
      continue;
    }
    works.push(built);
  }

  let anilist: Map<string, AniListRecord> | undefined;
  if (options.anilist) {
    const refs = works.flatMap((work) => [
      { malType: work.page.malType, malId: work.page.malId },
      ...work.relations.map((relation) => ({
        malType: relation.target.malType,
        malId: relation.target.malId,
      })),
    ]);
    process.stderr.write(`resolving ${refs.length} AniList ids\n`);
    anilist = await resolveAniList(refs, {
      delayMs: options.delayMs,
      onWarn: (message) => process.stderr.write(`${message}\n`),
    });
  }

  const payload = assemblePayload(works, { anilist });
  payload.skipped.push(...skipped);

  const seed = mergeSeedFiles(
    options.merge ? await readSeedFile(options.merge) : null,
    toSeedFile(payload),
  );

  const json = `${JSON.stringify(seed, null, 2)}\n`;
  if (options.out) {
    await writeFile(options.out, json, 'utf8');
    process.stderr.write(
      `wrote ${options.out}: ${seed.catalog_media.length} media, ${seed.catalog_media_relation.length} relations\n`,
    );
  } else if (!options.publish) {
    process.stdout.write(json);
  }

  for (const warning of payload.warnings) process.stderr.write(`warning: ${warning}\n`);

  if (!options.publish) return 0;

  const catalogUrl = options.catalogUrl ?? process.env.CATALOG_URL;
  const token = options.token ?? process.env.CATALOG_ADMIN_TOKEN;
  if (!catalogUrl || !token) {
    throw new Error(
      '--publish needs --catalog-url ($CATALOG_URL) and --token ($CATALOG_ADMIN_TOKEN)',
    );
  }
  const result = await publishPayload(payload, {
    catalogUrl,
    token,
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  process.stderr.write(
    `published ${result.media.length} media, ${result.relations.length} relations, ${result.failures.length} failures\n`,
  );
  for (const failure of result.failures) process.stderr.write(`failure: ${failure}\n`);
  if (options.out) process.stderr.write(`payload written to ${options.out}\n`);
  return result.failures.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
