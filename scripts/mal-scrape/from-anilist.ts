/**
 * Import top anime from AniList instead of scraping MyAnimeList.
 *
 * Why this exists: AniList is the catalog's identity provider (ADR-0001), and its
 * GraphQL API answers with the `id` a canonical uuid is derived from, the full
 * slim row, *and* every relation — 50 works per request. The MAL scraper needs
 * three sources and ~2.2 s per work to assemble the same facts. This needs ~0.4 s
 * per 50.
 *
 * Two orderings are supported:
 *
 * - `--source mal-ranking` (default) walks MAL's ranking pages for their links
 *   only (200 cheap list pages, no detail pages) and resolves those MAL ids
 *   through `idMal_in`. The set and order stay exactly MAL's top 10000.
 * - `--source anilist` walks AniList's own `Page(media: {sort})`, no MAL at all.
 *   Note the API caps a score-sorted walk at 5000 entries.
 *
 * Relation targets are written as rows too. The catalog's edge table has FKs on
 * both ends and `POST /v1/admin/relations` rejects an unknown endpoint, so an
 * edge whose target is not a `catalog_media` row could never be published.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ANILIST_MAX_PER_PAGE,
  createAniListClient,
  mediaByMalIdsQuery,
  mediaBySortQuery,
  mediaFields,
  type AniListDate,
  type AniListMedia,
  type AniListPage,
  type AniListStaffEdge,
} from './anilist.ts';
import {
  IDENTITY_PROVIDER_BY_KIND,
  RELATION_RULES,
  type DraftMedia,
  type MediaKind,
  type MediaRelationType,
  type MediaStatus,
  type Payload,
  type ProviderCredit,
  type SeedFile,
  type SeedRelationRow,
  canonicalMediaId,
  emptySeed,
  mergeSeedFiles,
  normalizeGenres,
  planAdaptation,
  prose,
  providerMetadata,
  providerUrl,
  publishPayload,
  readSeedFile,
} from './scrape.ts';
import { listUrl, parseTopAnimePage } from './top-anime.ts';

/* ------------------------------------------------------------------ *
 * Mapping: AniList media → catalog row
 * ------------------------------------------------------------------ */

/** AniList `MediaFormat` values this catalog tracks, by kind. */
const ANIME_FORMATS = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'TV_SHORT']);
const MANGA_FORMATS = new Set(['MANGA', 'ONE_SHOT']);

export interface KindResult {
  kind: MediaKind | null;
  reason?: string;
}

/**
 * `Media.type`/`Media.format` → Trackt kind. Mirrors `mapKind` in scrape.ts
 * (which speaks MAL's vocabulary) and refuses the same things: a music video is
 * not a work, a light novel is not a manga, and a manhwa is a webtoon — real, but
 * without an identity provider, so it cannot be given a canonical id.
 */
export function mapAniListKind(type: string | null, format: string | null): KindResult {
  const normalized = (format ?? '').toUpperCase();
  if (type === 'ANIME') {
    // Films stay `anime`: their identity provider is AniList, while `movie` rows
    // are keyed on TMDB (ADR-0001).
    if (ANIME_FORMATS.has(normalized)) return { kind: 'anime' };
    return { kind: null, reason: `AniList format '${format}' is not a trackable work` };
  }
  if (type === 'MANGA') {
    if (MANGA_FORMATS.has(normalized)) return { kind: 'manga' };
    if (normalized === 'MANHWA') {
      return { kind: 'webtoon', reason: 'webtoons have no identity provider, so no canonical id' };
    }
    return { kind: null, reason: `AniList format '${format}' is not a manga (novel)` };
  }
  return { kind: null, reason: `unsupported AniList type '${type}'` };
}

const ANILIST_STATUS: Record<string, MediaStatus> = {
  RELEASING: 'airing',
  FINISHED: 'ended',
  NOT_YET_RELEASED: 'announced',
  CANCELLED: 'cancelled',
};

/** `HIATUS` is an airing anime and a publishing manga — the kind breaks the tie. */
export function mapAniListStatus(status: string | null, kind: MediaKind): MediaStatus | null {
  if (!status) return null;
  if (status === 'HIATUS') return kind === 'anime' ? 'airing' : 'publishing';
  return ANILIST_STATUS[status] ?? null;
}

/**
 * AniList's `asHtml: false` text is still not plain — it carries `<br>` and
 * `<i>`/`<b>` emphasis — so it goes through the same normaliser a MAL synopsis
 * does. Provider placeholders (`N/A`, `-`) become null rather than being stored
 * as if they were prose.
 */
export function meaningfulDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = prose(raw);
  if (!text || /^(n\/a|none|tba|unknown|-+)$/i.test(text)) return null;
  return text;
}

type TitleShape = {
  title: { romaji?: string | null; english?: string | null; native?: string | null };
};

function titleOf(node: TitleShape): string | null {
  return node.title.english ?? node.title.romaji ?? node.title.native ?? null;
}

/* ------------------------------------------------------------------ *
 * Synonyms
 * ------------------------------------------------------------------ */

/**
 * `synonyms` is AniList's free-text bucket: romanizations, marketing subtitles,
 * typos and translated titles in a dozen scripts. The catalog keeps four strings
 * at most — the romaji original, the English title, and one French and one
 * Spanish title — because the detail page renders all of them as a single
 * "also known as" line.
 *
 * AniList stamps no language on a synonym, so French and Spanish have to be
 * recognised from the text. The lists below hold only words and spellings that
 * are exclusive to one of the two languages: anything shared (`de`, `la`,
 * `magia`, `historia`, `saga`, `final`, `dragon`…) is deliberately absent, since
 * it says nothing about the language and is what mislabels a Portuguese or
 * Italian title. A candidate showing another language's mark at all is dropped
 * rather than guessed at — a missing translation is cheaper than a wrong one.
 */
const FRENCH_WORDS = new Set(
  `le les des du une aux et dans pour avec sur cette ces très au est sont comme mais tout
   tous toute toutes qui que chez sans sous entre encore toujours jamais aussi alors quand donc
   amour ange apothicaire aube aventure baiser bataille carnet carnets château chevalier
   chevaliers chien ciel cité cœur coeur conte démon dernier dernière école enfant enquête épée
   étoile famille femme feu fille forêt frère garçon glace guerre héros héroïne histoire homme
   jour larme légende lumière lune madame magicien mère monsieur monstre mort nuit nouveau
   nouvelle ombre père petit petite pluie premier première deuxième troisième princesse récit
   reine rêve roi royaume saison sœur soeur soleil sortilège temps terre titan tome vie
   ville voix voyage voyageur`
    .split(/\s+/)
    .filter(Boolean),
);

const SPANISH_WORDS = new Set(
  `el los las del unas unos más también muy mucho casi siempre nunca cuando donde aunque pero
   porque desde hasta según además es y
   bosque bruja brujo caballero camino castillo corazón cuaderno demonio día diarios doncella
   escuela espíritu estrella eternidad eterno fuego héroe héroes hermana hermano hielo hija
   hijo imperio infierno isla lágrima leyenda lluvia maga mañana milagro monstruo mujer niño niña
   noche nueva nuevo ojo película pequeño pequeña perro pueblo recuerdos reina rey sangre segunda
   señor señora silencio sueño temporada tierra titán titanes túnel último última primera tercera
   viaje viejo vieja ciudad`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words that belong to neither target language. One is enough to disqualify. */
const OTHER_LANGUAGE_WORDS = new Set(
  `der die das und ein eine einer eines einem dem den mit von zu im ist nicht auf für über
   welt stadt reise schwert ritter stern traum träne abenteuer staffel zweite dritte letzte
   geschichte stimme schloss könig krieger herz nacht leben tod himmel erde hexe dämon engel blut
   eis schatten licht prinz prinzessin hund schule land freund mutter vater bruder schwester kind
   junge mann frau titan angriff geist wunder schlacht
   il lo gli della dei delle nel nella nello alla allo agli sul sulla che non più di da sono
   questo questa viaggio voce silenzio castello città sogno spada cavaliere stella lacrima parte
   guerriero strega streghe demone angelo sangue fuoco ghiaccio regno principe principessa regina
   cane paese famiglia amico amica madre padre fratello sorella bambino bambina uomo donna figlio
   mostro titano attacco leggenda spirito miracolo battaglia impero storia oltre
   não nao uma do da dos das os as ao aos em com seu sua pelo pela mais filme coração silêncio
   jornada vingança história você até após além porém através
   ve bir ile için nin lar ler și lui din cu pe sunt
   i w na z się że jest oraz dla przez
   og och av på med til den det ett jag han hon inte är om ikke
   és az hogy egy`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Letters that give away a language this importer does not carry: Vietnamese tone
 * marks, Turkish, Romanian, Polish, Czech, Nordic and Hungarian diacritics.
 * `â`/`ê`/`ô`/`ç` are absent on purpose — French uses them too.
 */
const OTHER_LANGUAGE_LETTERS = /[ãõăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹışğșțăøåæßőű]/u;

/** What a title may consist of: Latin letters, marks, digits, spaces, punctuation. */
const TITLE_CHARACTERS = /^[\p{Script=Latin}\p{M}\p{N}\p{Zs}\s\-'’!?.,:;"“”‘’()\[\]&/+#*~·…–—|]+$/u;

export function normalizeTitle(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Comparison key for "is this the same title?": case and accent folding, so the
 * uppercase or unaccented repeat of the row title (`LES MISÉRABLES` when the row
 * is already `Les Misérables`) does not survive as a synonym of itself.
 */
export function titleKey(raw: string): string {
  return normalizeTitle(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

/** Anything outside the Latin alphabet is a translation this catalog does not store. */
export function isLatinTitle(text: string): boolean {
  return TITLE_CHARACTERS.test(normalizeTitle(text));
}

function titleWords(text: string): string[] {
  return normalizeTitle(text)
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

export interface LanguageScores {
  fr: number;
  es: number;
  other: number;
}

export function scoreTitleLanguage(text: string): LanguageScores {
  const scores: LanguageScores = { fr: 0, es: 0, other: 0 };
  for (const word of titleWords(text)) {
    if (FRENCH_WORDS.has(word)) scores.fr++;
    if (SPANISH_WORDS.has(word)) scores.es++;
    if (OTHER_LANGUAGE_WORDS.has(word)) scores.other++;
  }
  // The one Spanish mark no other language here uses.
  if (/[ñ¿¡]/u.test(text)) scores.es += 2;
  if (OTHER_LANGUAGE_LETTERS.test(text)) scores.other++;
  return scores;
}

/** `fr`/`es` when the title reads as exactly one of them, else null. */
export function titleLanguage(text: string): 'fr' | 'es' | null {
  if (!isLatinTitle(text) || titleWords(text).length > 8) return null;
  const { fr, es, other } = scoreTitleLanguage(text);
  if (other > 0 || fr === es) return null;
  return fr > es ? 'fr' : 'es';
}

/**
 * The four synonyms a row keeps, in display order. A translated title is only
 * taken from `synonyms` — the romaji and English titles come from `title`, where
 * AniList actually states them.
 */
export function curateSynonyms(node: {
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[] | null;
}): string[] {
  const title = normalizeTitle(titleOf(node) ?? '');
  const taken = new Set([titleKey(title)]);
  const keep = (raw: string | null | undefined): string | null => {
    const clean = normalizeTitle(raw ?? '');
    const key = titleKey(clean);
    if (!clean || taken.has(key)) return null;
    taken.add(key);
    return clean;
  };

  const japanese = isLatinTitle(node.title.romaji ?? '') ? keep(node.title.romaji) : null;
  const english = keep(node.title.english);

  const localized: Record<'fr' | 'es', { text: string; score: number }> = {
    fr: { text: '', score: 0 },
    es: { text: '', score: 0 },
  };
  for (const candidate of node.synonyms ?? []) {
    const clean = normalizeTitle(candidate);
    if (!clean || taken.has(titleKey(clean))) continue;
    const language = titleLanguage(clean);
    if (!language) continue;
    const score = scoreTitleLanguage(clean)[language];
    if (score > localized[language].score) localized[language] = { text: clean, score };
  }

  return [
    japanese,
    english,
    keep(localized.fr.text || null),
    keep(localized.es.text || null),
  ].filter((value): value is string => value !== null);
}

/**
 * `anilist` and `mal`, and nothing else: AniList's `externalLinks` are streaming
 * and official-site links carrying *AniList's* site ids, not AniDB/ANN ids. Those
 * two only come from a MAL page, so a row imported this way is thinner on
 * `external_ids` than one scraped from MAL — neither is used for identity.
 */
function externalIdsOf(node: AniListNodeLike): Record<string, string | number> {
  const ids: Record<string, string | number> = { anilist: node.id };
  if (node.idMal) ids.mal = node.idMal;
  return ids;
}

/* ------------------------------------------------------------------ *
 * Credits and provider facts
 * ------------------------------------------------------------------ */

/**
 * The staff roles worth a credit line: who ran the work, who wrote it, who drew
 * it. AniList files every key animator, in-between and dub director as a staff
 * edge too, so a whitelist is the filter — voice actors are a separate
 * `characters` connection and never reach here.
 *
 * A role's trailing parenthetical is dropped before matching because AniList
 * qualifies roles instead of splitting them: `Story & Art (vols 1-41)`,
 * `Script (German)`, `Editing (2020-2023)`.
 */
const ANIME_CREDIT_ROLES = new Set([
  'Director',
  'Original Creator',
  'Original Story',
  'Series Composition',
  'Script',
  'Character Design',
  'Music',
]);

/** `Story & Art` is the single-credited mangaka; `Story`/`Art` the split team. */
const MANGA_CREDIT_ROLES = new Set([
  'Story & Art',
  'Story',
  'Art',
  'Original Creator',
  'Original Story',
]);

function baseCreditRole(role: string): string {
  return role.trim().replace(/\s*\([^()]*\)\s*$/, '');
}

export function creditsOf(node: AniListNodeLike, kind: MediaKind): ProviderCredit[] {
  const allowed = kind === 'anime' ? ANIME_CREDIT_ROLES : MANGA_CREDIT_ROLES;
  const credits: ProviderCredit[] = [];
  const seen = new Set<string>();
  for (const edge of node.staff?.edges ?? []) {
    const name = edge.node?.name?.full?.trim();
    const role = baseCreditRole(edge.role);
    if (!name || !allowed.has(role)) continue;
    const key = `${role}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ role, name });
  }
  return credits;
}

export function studiosOf(node: AniListNodeLike): string[] {
  const names = (node.studios?.nodes ?? []).map((studio) => studio.name.trim()).filter(Boolean);
  return [...new Set(names)];
}

/** AniList's partial date → `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; null when unset. */
export function isoDate(
  date: { year?: number | null; month?: number | null; day?: number | null } | null | undefined,
): string | null {
  const year = date?.year;
  if (!year) return null;
  const month =
    date.month && date.month >= 1 && date.month <= 12 ? String(date.month).padStart(2, '0') : null;
  const day =
    month && date.day && date.day >= 1 && date.day <= 31 ? String(date.day).padStart(2, '0') : null;
  return [year, month, day].filter((part) => part !== null && part !== undefined).join('-');
}

type AniListNodeLike = {
  id: number;
  idMal: number | null;
  type?: string | null;
  format?: string | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[] | null;
  genres?: string[] | null;
  averageScore?: number | null;
  episodes?: number | null;
  chapters?: number | null;
  seasonYear?: number | null;
  status?: string | null;
  startDate?: AniListDate | null;
  endDate?: AniListDate | null;
  duration?: number | null;
  volumes?: number | null;
  studios?: { nodes: { name: string }[] } | null;
  staff?: { edges: AniListStaffEdge[] } | null;
  coverImage?: { large?: string | null } | null;
  bannerImage?: string | null;
  description?: string | null;
};

export interface RowOptions {
  withDescription?: boolean;
  withCover?: boolean;
  withBanner?: boolean;
}

export interface RowResult {
  row: DraftMedia | null;
  kind: MediaKind | null;
  reason?: string;
}

/**
 * One AniList node → one `catalog_media` row. `seasonNumber` is deliberately left
 * null: it is an ordinal within a franchise, which only the whole graph knows —
 * `assignSeasonNumbers` fills it once every edge is in.
 */
export function rowFromMedia(media: AniListNodeLike, options: RowOptions = {}): RowResult {
  const decision = mapAniListKind(media.type ?? null, media.format ?? null);
  if (!decision.kind) return { row: null, kind: null, reason: decision.reason };

  const title = titleOf(media);
  if (!title) return { row: null, kind: decision.kind, reason: 'no title on the AniList record' };

  const synonyms = curateSynonyms(media);

  const kind = decision.kind;
  const row: DraftMedia = {
    id: IDENTITY_PROVIDER_BY_KIND[kind] ? canonicalMediaId(kind, media.id) : null,
    kind,
    title,
    synonyms,
    year: media.seasonYear ?? media.startDate?.year ?? null,
    status: mapAniListStatus(media.status ?? null, kind),
    genres: normalizeGenres(media.genres ?? []),
    partCount: kind === 'anime' ? (media.episodes ?? null) : (media.chapters ?? null),
    seasonNumber: null,
    externalIds: externalIdsOf(media),
    metadata: providerMetadata({
      score: media.averageScore ?? null,
      format: media.format ?? null,
      startDate: isoDate(media.startDate),
      endDate: isoDate(media.endDate),
      duration: media.duration ?? null,
      volumes: media.volumes ?? null,
      studios: studiosOf(media),
      credits: creditsOf(media, kind),
    }),
    description: options.withDescription ? meaningfulDescription(media.description) : null,
    coverUrl: options.withCover ? (media.coverImage?.large ?? null) : null,
    bannerUrl: options.withBanner === false ? null : (media.bannerImage ?? null),
  };
  return { row, kind, reason: decision.reason };
}

/** AniList's relation enum → the label `RELATION_RULES` is keyed by. */
export const ANILIST_RELATION_LABELS: Record<string, string> = {
  SEQUEL: 'sequel',
  PREQUEL: 'prequel',
  SIDE_STORY: 'side story',
  SPIN_OFF: 'spin-off',
  PARENT: 'parent story',
  ADAPTATION: 'adaptation',
  ALTERNATIVE: 'alternative version',
  SUMMARY: 'summary',
  FULL_STORY: 'full story',
  CHARACTER: 'character',
  OTHER: 'other',
};

export type EdgeSkip = { title: string; anilistId: number; reason: string };

export type EdgePlan =
  | {
      ok: true;
      edge: SeedRelationRow;
      /** The target as its own row, so the edge is publishable at all. */
      target: DraftMedia | null;
    }
  | { ok: false; skipped: EdgeSkip };

export interface PlanEdgesOptions extends RowOptions {
  relationOverrides?: Record<string, MediaRelationType>;
}

/**
 * Turn one work's `relations` into publishable edges plus the rows their targets
 * need. Both ids are AniList ids, so nothing has to be looked up: the only way an
 * edge is dropped is a target this catalog cannot identify (a webtoon) or cannot
 * track (a music video, a novel).
 */
export function planEdges(
  media: AniListMedia,
  sourceKind: MediaKind,
  options: PlanEdgesOptions = {},
): EdgePlan[] {
  const sourceId = canonicalMediaId(sourceKind, media.id);
  const plans: EdgePlan[] = [];

  for (const { relationType, node } of media.relations?.edges ?? []) {
    const label = ANILIST_RELATION_LABELS[relationType]?.toLowerCase();
    const rule = label
      ? options.relationOverrides?.[label]
        ? {
            action: 'edge' as const,
            type: options.relationOverrides[label]!,
            direction: 'forward' as const,
          }
        : RELATION_RULES[label]
      : undefined;

    const skip = (reason: string): void => {
      plans.push({
        ok: false,
        skipped: { title: titleOf(node) ?? `AniList ${node.id}`, anilistId: node.id, reason },
      });
    };

    if (!rule) {
      skip(`unmapped AniList relation '${relationType}'`);
      continue;
    }
    if (rule.action === 'skip') {
      skip(rule.reason);
      continue;
    }

    const targetDecision = mapAniListKind(node.type, node.format);
    if (!targetDecision.kind) {
      skip(targetDecision.reason ?? 'unsupported target kind');
      continue;
    }
    if (!IDENTITY_PROVIDER_BY_KIND[targetDecision.kind]) {
      skip(`target is a ${targetDecision.kind}, which has no canonical identity`);
      continue;
    }

    let direction: 'forward' | 'reverse';
    if (rule.action === 'kind-dependent') {
      const planned = planAdaptation(sourceKind, targetDecision.kind);
      if ('reason' in planned) {
        skip(planned.reason);
        continue;
      }
      direction = planned.direction;
    } else {
      direction = rule.direction;
    }

    const targetId = canonicalMediaId(targetDecision.kind, node.id);
    let fromId = direction === 'forward' ? sourceId : targetId;
    let toId = direction === 'forward' ? targetId : sourceId;
    if (fromId === toId) continue;
    const type = rule.action === 'kind-dependent' ? ('adaptation' as const) : rule.type;
    if (type === 'related' && fromId > toId) [fromId, toId] = [toId, fromId];

    const target = rowFromMedia(
      { ...node, type: node.type, format: node.format } as AniListNodeLike & {
        type: string;
        format: string | null;
      },
      options,
    ).row;
    plans.push({ ok: true, edge: { fromId, toId, type }, target });
  }
  return plans;
}

/* ------------------------------------------------------------------ *
 * Season numbering, from the sequel chain
 * ------------------------------------------------------------------ */

/**
 * `season_number` is an ordinal inside a franchise, and no single page states it:
 * MAL only implies it (`Premiered: Fall 2023`) and AniList only says `seasonYear`.
 * The edge graph does — `A →sequel→ B` means B comes after A — so once every row
 * and edge is loaded, the ordinal is a longest-path depth. A work with two prequels
 * (a split cour) takes the deepest.
 *
 * Works with no sequel edge keep 1; series/anime rows that already carried a
 * number from another source are overwritten, because this is computed from the
 * edges rather than guessed from a title.
 */
export function assignSeasonNumbers(seed: SeedFile): number {
  // A season ordinal only means something inside one medium: AniList files a
  // manga spin-off as a `sequel` of its anime (Cyberpunk: Edgerunners MADNESS),
  // and counting that edge would push the 2022 season to "Season 2".
  const kindOf = new Map(seed.catalog_media.map((row) => [row.id, row.kind]));
  const predecessors = new Map<string, string[]>();
  for (const edge of seed.catalog_media_relation) {
    if (edge.type !== 'sequel') continue;
    if (kindOf.get(edge.fromId) !== kindOf.get(edge.toId)) continue;
    const list = predecessors.get(edge.toId) ?? [];
    list.push(edge.fromId);
    predecessors.set(edge.toId, list);
  }

  const depth = new Map<string, number>();
  const inFlight = new Set<string>();
  const resolve = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (inFlight.has(id)) return 0; // a cycle would be a bad edge; never loop on it
    inFlight.add(id);
    const parents = predecessors.get(id) ?? [];
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(resolve)) + 1;
    inFlight.delete(id);
    depth.set(id, value);
    return value;
  };

  let assigned = 0;
  for (const row of seed.catalog_media) {
    if (row.kind !== 'anime' && row.kind !== 'series') continue;
    const season = resolve(row.id) + 1;
    if (row.seasonNumber !== season) {
      row.seasonNumber = season;
      assigned++;
    }
  }
  return assigned;
}

/* ------------------------------------------------------------------ *
 * Importing one page of works
 * ------------------------------------------------------------------ */

export interface ImportOptions extends RowOptions {
  relationOverrides?: Record<string, MediaRelationType>;
}

export interface ImportedPage {
  media: DraftMedia[];
  edges: SeedRelationRow[];
  skipped: { anilistId: number; title: string; reason: string }[];
  warnings: string[];
}

/** Fold a page of AniList media into rows, target rows and edges, deduped. */
export function importAniListMedia(
  items: AniListMedia[],
  options: ImportOptions = {},
): ImportedPage {
  const media = new Map<string, DraftMedia>();
  const edges = new Map<string, SeedRelationRow>();
  const skipped: ImportedPage['skipped'] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const built = rowFromMedia(item, options);
    if (built.reason) warnings.push(`${titleOf(item) ?? item.id}: ${built.reason}`);
    if (!built.row || !built.kind || !built.row.id) {
      skipped.push({
        anilistId: item.id,
        title: titleOf(item) ?? String(item.id),
        reason: built.reason ?? 'unsupported kind',
      });
      continue;
    }
    media.set(built.row.id, built.row);

    for (const plan of planEdges(item, built.kind, options)) {
      if (!plan.ok) {
        skipped.push({
          anilistId: plan.skipped.anilistId,
          title: plan.skipped.title,
          reason: plan.skipped.reason,
        });
        continue;
      }
      edges.set(`${plan.edge.fromId}:${plan.edge.toId}:${plan.edge.type}`, plan.edge);
      // A work can be this page's own row *and* another work's relation target,
      // and the relation node is the poorer of the two (no credits, no studios).
      // The target only fills a gap; it never replaces a top-level row.
      if (plan.target?.id && !media.has(plan.target.id)) media.set(plan.target.id, plan.target);
    }
  }

  return { media: [...media.values()], edges: [...edges.values()], skipped, warnings };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const HELP = `Import top anime from AniList (identity provider) into a catalog seed file.

Usage:
  node scripts/mal-scrape/from-anilist.ts [options]

Source:
  --kind <anime|manga>   which AniList namespace to walk (default anime); also
                         picks MAL's topanime/topmanga list and the default output
  --source mal-ranking   walk MAL's ranking for its links only (200 list pages,
                          no detail pages) and resolve them via AniList (default)
  --source anilist       walk AniList's own ranking; no MAL involved (capped at
                         5000 entries, so it cannot reach a top 10k on its own)
  --sort <MediaSort>     with --source anilist (default SCORE_DESC)
  --max-rank <n>         stop after this rank (default 10000)
  --from-rank <n>        start at this rank (default 1)
  --types <list>         AniList formats to keep, comma-separated
                         (default tv,movie,ova,ona,special,tv_short; manga:
                         manga,one_shot)

Output:
  --out <file>           seed file (default apps/catalog/seed/top-<kind>-anilist.json)
  --merge <file>         fold this run into an existing seed file
  --with-description     include AniList synopses (default: null)
  --without-cover        drop cover art URLs (included by default: cover_url is
                         a real catalog column)
  --without-banner       drop banner URLs (included by default: the detail page's
                         header uses them, and falls back to the cover)
  --publish              POST the accumulated seed when the walk finishes
  --catalog-url <url>    default $CATALOG_URL
  --token <token>        default $CATALOG_ADMIN_TOKEN

Politeness:
  --delay <ms>           gap between AniList requests (default 2000; the API
                         reports a 30 requests/minute limit)

  --help                 this text

Manga:  node scripts/mal-scrape/from-anilist.ts --kind manga
`;

export const DEFAULT_TYPES = ['tv', 'movie', 'ova', 'ona', 'special', 'tv_short'];
/** AniList `MediaFormat` values a manga walk keeps (novels and manhwa are refused by kind). */
export const DEFAULT_MANGA_TYPES = ['manga', 'one_shot'];

export interface FromAniListOptions {
  source: 'mal-ranking' | 'anilist';
  /** Which AniList namespace the walk resolves: anime or manga. */
  kind: 'anime' | 'manga';
  sort: string;
  maxRank: number;
  fromRank: number;
  types: Set<string>;
  out: string;
  merge?: string;
  withDescription: boolean;
  withCover: boolean;
  withBanner: boolean;
  publish: boolean;
  catalogUrl?: string;
  token?: string;
  delayMs: number;
  help: boolean;
}

export function parseFromAniListArgs(argv: string[]): FromAniListOptions {
  const options: FromAniListOptions = {
    source: 'mal-ranking',
    kind: 'anime',
    sort: 'SCORE_DESC',
    maxRank: 10000,
    fromRank: 1,
    types: new Set(DEFAULT_TYPES),
    out: 'apps/catalog/seed/top-anime-anilist.json',
    withDescription: false,
    withCover: true,
    withBanner: true,
    publish: false,
    delayMs: 2000,
    help: false,
  };
  const flags = new Set([
    '--with-description',
    '--with-cover',
    '--without-cover',
    '--without-banner',
    '--publish',
    '--help',
  ]);
  const valued: Record<string, (value: string) => void> = {
    '--kind': (value) => {
      if (value !== 'anime' && value !== 'manga')
        throw new Error("--kind must be 'anime' or 'manga'");
      options.kind = value;
      options.types = new Set(value === 'manga' ? DEFAULT_MANGA_TYPES : DEFAULT_TYPES);
      options.out = `apps/catalog/seed/top-${value}-anilist.json`;
    },
    '--source': (value) => {
      if (value !== 'mal-ranking' && value !== 'anilist') {
        throw new Error("--source must be 'mal-ranking' or 'anilist'");
      }
      options.source = value;
    },
    '--sort': (value) => (options.sort = value.toUpperCase()),
    '--max-rank': (value) => (options.maxRank = Number(value)),
    '--from-rank': (value) => (options.fromRank = Number(value)),
    '--types': (value) =>
      (options.types = new Set(
        value
          .toLowerCase()
          .split(',')
          .map((type) => type.trim()),
      )),
    '--out': (value) => (options.out = value),
    '--merge': (value) => (options.merge = value),
    '--catalog-url': (value) => (options.catalogUrl = value),
    '--token': (value) => (options.token = value),
    '--delay': (value) => (options.delayMs = Number(value)),
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.has(arg)) {
      if (arg === '--with-description') options.withDescription = true;
      if (arg === '--with-cover') options.withCover = true;
      if (arg === '--without-cover') options.withCover = false;
      if (arg === '--without-banner') options.withBanner = false;
      if (arg === '--publish') options.publish = true;
      if (arg === '--help') options.help = true;
      continue;
    }
    const setter = valued[arg];
    if (!setter) throw new Error(`unknown option ${arg}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    setter(value);
  }

  if (!Number.isInteger(options.maxRank) || options.maxRank < 1) {
    throw new Error('--max-rank must be a positive integer');
  }
  if (!Number.isInteger(options.fromRank) || options.fromRank < 1) {
    throw new Error('--from-rank must be a positive integer');
  }
  if (options.fromRank > options.maxRank) throw new Error('--from-rank is past --max-rank');
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay must be a non-negative number of milliseconds');
  }
  return options;
}

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
  return `${total}s`;
}

export interface WalkResult {
  seed: SeedFile;
  imported: number;
  rows: number;
  edges: number;
  skipped: number;
  requests: number;
  pages: number;
}

export interface WalkDeps {
  client?: ReturnType<typeof createAniListClient>;
  fetchHtml?: (url: string) => Promise<string>;
  readSeed?: (path: string) => Promise<SeedFile | null>;
  writeSeed?: (path: string, seed: SeedFile) => Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * Resolve MAL ranking pages through `idMal_in`: the cheapest way to keep MAL's
 * exact top-10000 set and order while taking every fact from AniList.
 */
async function walkMalRanking(
  options: FromAniListOptions,
  client: NonNullable<WalkDeps['client']>,
  deps: Required<Pick<WalkDeps, 'fetchHtml' | 'log' | 'now'>>,
  onPage: (items: AniListMedia[]) => Promise<void>,
): Promise<number> {
  const query = mediaByMalIdsQuery(
    mediaFields({ withDescription: options.withDescription }),
    options.kind === 'manga' ? 'MANGA' : 'ANIME',
  );
  const startLimit = Math.floor((options.fromRank - 1) / 50) * 50;
  let pages = 0;

  for (let limit = startLimit; limit < options.maxRank; limit += 50) {
    const entries = parseTopAnimePage(await deps.fetchHtml(listUrl(limit, options.kind))).filter(
      (entry) => entry.rank >= options.fromRank && entry.rank <= options.maxRank,
    );
    if (entries.length === 0) break;
    const ids = entries.map((entry) => entry.malId);

    for (let offset = 0; offset < ids.length; offset += ANILIST_MAX_PER_PAGE) {
      const chunk = ids.slice(offset, offset + ANILIST_MAX_PER_PAGE);
      const envelope = await client.query<{ Page: AniListPage<AniListMedia> }>(query, {
        ids: chunk,
        page: 0,
        perPage: ANILIST_MAX_PER_PAGE,
      });
      await onPage(envelope.data?.Page.media ?? []);
    }
    pages++;
    deps.log(
      `ranks ${entries[0]!.rank}-${entries.at(-1)!.rank}: ${ids.length} MAL ids → ` +
        `${client.requestCount()} AniList requests so far`,
    );
  }
  return pages;
}

/** AniList's own ranking, 50 per page. */
async function walkAniListRanking(
  options: FromAniListOptions,
  client: NonNullable<WalkDeps['client']>,
  deps: Required<Pick<WalkDeps, 'log' | 'now'>>,
  onPage: (items: AniListMedia[]) => Promise<void>,
): Promise<number> {
  const query = mediaBySortQuery(mediaFields({ withDescription: options.withDescription }));
  const perPage = ANILIST_MAX_PER_PAGE;
  const firstPage = Math.floor((options.fromRank - 1) / perPage) + 1;
  const lastPage = Math.ceil(options.maxRank / perPage);
  let pages = 0;

  for (let page = firstPage; page <= lastPage; page++) {
    const envelope = await client.query<{ Page: AniListPage<AniListMedia> }>(query, {
      sort: [options.sort],
      type: options.kind === 'manga' ? 'MANGA' : 'ANIME',
      page,
      perPage,
    });
    const items = envelope.data?.Page.media ?? [];
    if (items.length === 0) break;
    await onPage(items);
    pages++;
    deps.log(
      `anilist page ${page}/${envelope.data?.Page.pageInfo.lastPage ?? '?'}: ${items.length} works`,
    );
    if (!envelope.data?.Page.pageInfo.hasNextPage) break;
  }
  return pages;
}

export async function walkImport(
  options: FromAniListOptions,
  deps: WalkDeps = {},
): Promise<WalkResult> {
  const client = deps.client ?? createAniListClient({ spacingMs: options.delayMs });
  const fetchHtml =
    deps.fetchHtml ??
    (async (url: string) => {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'trackt-catalog-scraper/0.1 (+https://github.com/pvrnn/Trackt)',
          Accept: 'text/html',
        },
      });
      if (!response.ok) throw new Error(`MAL ${response.status} for ${url}`);
      return response.text();
    });
  const readSeed = deps.readSeed ?? readSeedFile;
  const writeSeed =
    deps.writeSeed ??
    ((path, seed) => writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, 'utf8'));
  const log = deps.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const now = deps.now ?? (() => Date.now());

  // `--merge` names the file to fold into; otherwise an existing output file is
  // the base, so a rerun after a crash continues instead of starting over.
  let seed = (await readSeed(options.merge ?? options.out)) ?? emptySeed();

  const importOptions: ImportOptions = {
    withDescription: options.withDescription,
    withCover: options.withCover,
    withBanner: options.withBanner,
  };
  const startedAt = now();
  let imported = 0;
  let skipped = 0;
  let pages = 0;

  const onPage = async (items: AniListMedia[]) => {
    const kept = items.filter(
      (item) => !item.format || options.types.has(item.format.toLowerCase()),
    );
    const page = importAniListMedia(kept, importOptions);
    imported += kept.length;
    skipped += page.skipped.length;

    const folded = mergeSeedFiles(seed, {
      generatedAt: new Date().toISOString(),
      catalog_media: page.media.map((row) => row as SeedFile['catalog_media'][number]),
      catalog_media_relation: page.edges,
      urls: Object.fromEntries(
        page.media
          .map((row) => [row.id, row.id ? providerUrl(row.kind, row.externalIds) : null] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
      ),
      report: {
        sources: [],
        skipped: page.skipped.map((entry) => ({
          malId: entry.anilistId,
          title: entry.title,
          reason: entry.reason,
        })),
        warnings: page.warnings,
      },
    });
    assignSeasonNumbers(folded);
    seed = folded;
    await writeSeed(options.out, seed);
  };

  pages =
    options.source === 'anilist'
      ? await walkAniListRanking(options, client, { log, now }, onPage)
      : await walkMalRanking(options, client, { fetchHtml, log, now }, onPage);

  log(
    `${pages} pages: ${imported} works imported, ${skipped} skipped | ` +
      `seed ${seed.catalog_media.length} rows / ${seed.catalog_media_relation.length} edges | ` +
      `${client.requestCount()} AniList requests in ${clock(now() - startedAt)}`,
  );

  return {
    seed,
    imported,
    rows: seed.catalog_media.length,
    edges: seed.catalog_media_relation.length,
    skipped,
    requests: client.requestCount(),
    pages,
  };
}

export function seedToPayload(seed: SeedFile): Payload {
  return {
    generatedAt: seed.generatedAt,
    sources: seed.report.sources,
    media: seed.catalog_media.map((row) => ({ ...row })),
    relations: seed.catalog_media_relation.map((edge) => ({ ...edge })),
    skipped: seed.report.skipped,
    warnings: seed.report.warnings,
  };
}

export async function run(argv: string[]): Promise<number> {
  const options = parseFromAniListArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  await mkdir(dirname(options.out), { recursive: true });

  const result = await walkImport(options);
  process.stderr.write(
    `\nseed: ${options.out} (${result.rows} rows, ${result.edges} edges)\n` +
      `${result.requests} AniList requests\n`,
  );
  if (!options.publish) return 0;

  const catalogUrl = options.catalogUrl ?? process.env.CATALOG_URL;
  const token = options.token ?? process.env.CATALOG_ADMIN_TOKEN;
  if (!catalogUrl || !token) {
    throw new Error(
      '--publish needs --catalog-url ($CATALOG_URL) and --token ($CATALOG_ADMIN_TOKEN)',
    );
  }
  const published = await publishPayload(seedToPayload(result.seed), {
    catalogUrl,
    token,
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  process.stderr.write(
    `published ${published.media.length} media, ${published.relations.length} relations, ${published.failures.length} failures\n`,
  );
  for (const failure of published.failures) process.stderr.write(`failure: ${failure}\n`);
  return published.failures.length > 0 ? 1 : 0;
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
