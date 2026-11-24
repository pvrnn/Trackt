/**
 * Shared contract for the catalog research pass: what a verdict file may say,
 * and which edits a research agent is allowed to make.
 *
 * Two invariants the merge pass protects:
 *   - identity is frozen (ADR-0001). `externalIds.<provider>` for a row's own
 *     identity provider is NOT editable: changing it silently invalidates the
 *     canonical UUID and the seeder rejects the whole row.
 *   - a copy of a row can live in two seeds (the AniList seeds ship each
 *     other's kinds), and the seeder upserts every column, so an edit applied
 *     to one copy is undone by the other. The merge writes every copy.
 */

export const RELATION_TYPES = ['sequel', 'adaptation', 'spinoff', 'related'];

/** Which column defines canonical identity per kind (packages/shared/src/media.ts). */
export const IDENTITY_PROVIDER = {
  movie: 'tmdb',
  series: 'tmdb',
  anime: 'anilist',
  manga: 'anilist',
  game: 'igdb',
  webtoon: null,
};

export const EDITABLE_EXTERNAL_IDS = ['tmdb', 'imdb', 'tvdb', 'anilist', 'mal', 'igdb', 'steam'];

export const EDITABLE_METADATA = [
  'providerScore',
  'ratingCount',
  'releaseDate',
  'airDate',
  'lastAirDate',
  'runtime',
  'episodeRuntime',
  'duration',
  'volumes',
  'studios',
  'networks',
  'directors',
  'writers',
  'creators',
  'credits',
  'originCountry',
  'spokenLanguages',
  'tagline',
  'originalLanguage',
  'format',
  'igdbStatus',
  'platforms',
  'igdbUrl',
  'totalSeasons',
  'totalEpisodes',
  'seriesType',
  'seasonName',
  'parentTitle',
  'editionTitle',
];
// `metadata.tmdb` is deliberately absent: dedup:tmdb owns it and it is a folded
// TMDB row (id, imdbId, networks…), not a scalar a research pass may overwrite.

const STATUSES = ['announced', 'airing', 'publishing', 'ended', 'cancelled'];

const isHttps = (value) => typeof value === 'string' && /^https?:\/\/\S+$/.test(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isTextList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
const isInt = (value) => Number.isInteger(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Validate one `path: value` edit against the row it targets.
 * Returns an error string, or null when the edit is acceptable.
 */
export function validateEdit(row, path, value) {
  if (typeof path !== 'string' || !path) return 'path must be a non-empty string';

  if (path === 'id' || path === 'kind' || path === 'seasonNumber') {
    return `${path} is identity-bearing and is never edited by research`;
  }
  if (path === 'metadata') return 'replace individual metadata.<key> fields, not the whole object';

  const external = /^externalIds\.([a-z]+)$/.exec(path);
  if (external) {
    const provider = external[1];
    if (!EDITABLE_EXTERNAL_IDS.includes(provider)) return `externalIds.${provider} is not editable`;
    if (IDENTITY_PROVIDER[row.kind] === provider) {
      return `externalIds.${provider} defines ${row.kind} identity; editing it invalidates id ${row.id}`;
    }
    if (!(isInt(value) || isText(value))) return `${path} must be an integer or non-empty string`;
    return null;
  }

  const meta = /^metadata\.([A-Za-z]+)$/.exec(path);
  if (meta) {
    const key = meta[1];
    if (!EDITABLE_METADATA.includes(key)) return `metadata.${key} is not an editable key`;
    switch (key) {
      case 'providerScore':
        if (!isNumber(value) || value < 0 || value > 100) return 'providerScore must be 0-100';
        return null;
      case 'ratingCount':
      case 'volumes':
      case 'runtime':
      case 'episodeRuntime':
      case 'duration':
      case 'totalSeasons':
      case 'totalEpisodes':
        if (!isInt(value) || value < 0) return `${path} must be a non-negative integer`;
        return null;
      case 'releaseDate':
      case 'airDate':
      case 'lastAirDate':
        if (typeof value !== 'string' || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) {
          return `${path} must be YYYY, YYYY-MM or YYYY-MM-DD`;
        }
        return null;
      case 'igdbUrl':
        if (!isHttps(value)) return 'igdbUrl must be an http(s) URL';
        return null;
      case 'credits':
        if (
          !Array.isArray(value) ||
          !value.every((item) => item && isText(item.role) && isText(item.name))
        ) {
          return 'credits must be [{ role, name }]';
        }
        return null;
      default:
        if (isTextList(value)) return null;
        if (isText(value)) return null;
        return `${path} must be text or a list of text`;
    }
  }

  switch (path) {
    case 'title':
      return 'title is matched on and used to derive slugs; never edited by research';
    case 'year':
      if (!isInt(value) || value < 1870 || value > 2035) return 'year must be 1870-2035';
      return null;
    case 'status':
      if (!STATUSES.includes(value)) return `status must be one of ${STATUSES.join('|')}`;
      return null;
    case 'partCount':
      if (value === null) return null;
      if (!isInt(value) || value < 0) return 'partCount must be a non-negative integer or null';
      return null;
    case 'genres':
      if (!isTextList(value)) return 'genres must be a non-empty list of lowercase tags';
      if (value.some((genre) => genre !== genre.toLowerCase() || genre.includes(','))) {
        return 'genres must be lowercase and comma-free';
      }
      return null;
    case 'synonyms':
      if (!isTextList(value)) return 'synonyms must be a list of non-empty strings';
      if (value.length > 6) return 'at most six synonyms';
      return null;
    case 'description':
      if (!isText(value)) return 'description must be non-empty text';
      if (value.length > 4000) return 'description is capped at 4000 characters';
      return null;
    case 'coverUrl':
    case 'bannerUrl':
      if (!isHttps(value)) return `${path} must be an http(s) URL`;
      return null;
    default:
      return `${path} is not an editable field`;
  }
}

/** Validate a whole result file against the batch it answers. */
export function validateResult(batch, result) {
  const errors = [];
  if (!result || !Array.isArray(result.verdicts)) {
    return ['result must be { batch, verdicts: [] }'];
  }
  const byNumber = new Map(batch.map((candidate) => [candidate.n, candidate]));
  const seen = new Set();

  for (const [index, verdict] of result.verdicts.entries()) {
    const where = `verdicts[${index}]`;
    const candidate = byNumber.get(verdict.n);
    if (!candidate) {
      errors.push(`${where}: n=${verdict.n} is not in this batch`);
      continue;
    }
    if (seen.has(verdict.n)) errors.push(`${where}: n=${verdict.n} answered twice`);
    seen.add(verdict.n);
    if (verdict.pairKey !== candidate.pairKey) {
      errors.push(`${where}: pairKey does not match candidate ${verdict.n}`);
    }
    if (!['linked', 'rejected'].includes(verdict.verdict)) {
      errors.push(`${where}: verdict must be linked|rejected`);
      continue;
    }
    if (!isText(verdict.reason)) errors.push(`${where}: reason is required`);
    if (verdict.evidence != null) {
      if (!Array.isArray(verdict.evidence) || !verdict.evidence.every(isHttps)) {
        errors.push(`${where}: evidence must be a list of http(s) URLs`);
      }
    }

    if (verdict.verdict === 'linked') {
      const link = verdict.link;
      if (!link) {
        errors.push(`${where}: linked requires link`);
      } else {
        const pair = new Set([candidate.left.id, candidate.right.id]);
        if (!RELATION_TYPES.includes(link.type)) errors.push(`${where}: bad link.type`);
        if (link.fromId === link.toId) errors.push(`${where}: self edge`);
        if (!pair.has(link.fromId) || !pair.has(link.toId)) {
          errors.push(`${where}: link endpoints must be candidate ${candidate.n}'s two ids`);
        }
        if (!isHttps(link.source)) errors.push(`${where}: link.source must be a URL`);
        if (link.confidence != null && !['high', 'medium', 'low'].includes(link.confidence)) {
          errors.push(`${where}: link.confidence must be high|medium|low`);
        }
      }
      if (!verdict.evidence || verdict.evidence.length === 0) {
        errors.push(`${where}: linked requires at least one evidence URL`);
      }
    }

    for (const [editIndex, edit] of (verdict.metadata ?? []).entries()) {
      const at = `${where}.metadata[${editIndex}]`;
      const row = [candidate.left, candidate.right].find((side) => side.id === edit.id);
      if (!row) errors.push(`${at}: id must be one of the candidate's two rows`);
      else {
        const problem = validateEdit(row, edit.path, edit.to);
        if (problem) errors.push(`${at}: ${problem}`);
      }
      if (!isHttps(edit.source)) errors.push(`${at}: source must be a URL`);
    }

    // A pair rejected because the two rows are ONE work (TMDB files a donghua as
    // one season where AniList has per-season rows) is not a relation at all; it
    // is a dedup target. Reported explicitly so the fold is a worklist, not prose.
    if (verdict.duplicate != null) {
      const duplicate = verdict.duplicate;
      const ids = new Set([candidate.left.id, candidate.right.id]);
      if (verdict.verdict !== 'rejected') errors.push(`${where}: duplicate only on a rejection`);
      if (!ids.has(duplicate.keepId) || !ids.has(duplicate.dropId)) {
        errors.push(`${where}.duplicate: keepId/dropId must be the candidate's two ids`);
      }
      if (duplicate.keepId === duplicate.dropId) errors.push(`${where}.duplicate: same id twice`);
      if (!isText(duplicate.note)) errors.push(`${where}.duplicate: note is required`);
      if (!isHttps(duplicate.source)) errors.push(`${where}.duplicate: source must be a URL`);
    }
  }

  const missing = batch.filter((candidate) => !seen.has(candidate.n));
  if (missing.length) {
    errors.push(`unanswered candidates: ${missing.map((c) => c.n).join(', ')}`);
  }
  return errors;
}
