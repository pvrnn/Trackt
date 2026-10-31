import { normaliseTitle } from './titles.js';

/**
 * Whether a provider row and a catalog row are the same work, once the provider
 * ids have failed: a score, not an equality.
 *
 * An equality refuses every ordinary difference — a hyphen, a subtitle, a
 * roman numeral, a spelling — and reads as "not in the catalog". A score keeps
 * the refusals that matter (a *near tie* is still a coin flip) and resolves the
 * rest, so a report can say "matched at 91%" instead of "absent".
 *
 * `kind` is not a weight: an anime and a manga never name the same work, so it
 * stays a filter. Year is scored, not filtered: providers disagree about the
 * year by a release convention (Letterboxd dates a festival premiere, TMDB the
 * theatrical run), so a year apart is ordinary and two years apart is a near
 * miss — the score says which, the threshold makes the call.
 */

/** Below this, a candidate is not the same work — it is a similar one. */
export const MATCH_THRESHOLD = 0.8;

/**
 * Two candidates closer than this cannot be told apart, so neither is taken.
 * This is what keeps the Cobweb case honest when nothing else distinguishes the
 * two rows — the score has to *separate* them, not merely be high.
 */
export const TIE_MARGIN = 0.01;

/**
 * Title is the evidence, the year corroborates, and a country that agrees is a
 * thumb on the scale. The three are averaged over the signals both sides state.
 *
 * With these weights a perfect title scores 1.00 on the same year, ~0.83 one
 * year out (a match) and ~0.75 two years out (a recorded near miss, below the
 * threshold) — the ladder an import needs when the two services date a film by
 * different releases.
 */
const TITLE_WEIGHT = 0.6;
const YEAR_WEIGHT = 0.3;
const COUNTRY_WEIGHT = 0.1;

/** Two years is the widest a `titleFallback` search looks: past that, not the work. */
export const MAX_YEAR_GAP = 2;

/** 1 on the same year, 0.5 one year out, 0.25 two — the weights scale these. */
function yearScore(subject: number | null, candidate: number | null): number | null {
  if (subject === null || candidate === null) return null;
  const gap = Math.abs(subject - candidate);
  if (gap > MAX_YEAR_GAP) return 0;
  return 1 / 2 ** gap;
}

/**
 * Edit similarity over the two normalised titles: `1 - distance / longest`.
 *
 * Edit distance rather than character n-grams because the failure that matters
 * is a *suffix*, not a typo: bigram overlap scores "Blade Runner" against
 * "Blade Runner 2049" at 0.82 — over the threshold — while it scores a
 * one-letter slip in a six-letter title at 0.83. The two cases look alike to a
 * bigram counter and could not be more different to a person.
 */
function characterSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 0;
  // One row of the matrix at a time: titles are short, but this runs per
  // candidate per entry across a whole profile.
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      const substitution = previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return 1 - previous[right.length]! / longest;
}

/** A word this close to another is the same word, spelled differently. */
const WORD_MATCH = 0.8;

/**
 * The share of words that found a partner, longest side as the denominator.
 * A character measure cannot tell "the grey" from "the prey" — one substitution
 * in two short words, 88% — while a person reads them as two different words.
 * This is that reading, and it is why the two measures are combined.
 */
function wordSimilarity(left: string, right: string): number {
  const leftWords = left.split(' ').filter(Boolean);
  const rightWords = right.split(' ').filter(Boolean);
  if (leftWords.length === 0 || rightWords.length === 0) return 0;
  const [shorter, longer] =
    leftWords.length <= rightWords.length ? [leftWords, rightWords] : [rightWords, leftWords];

  const used = new Set<number>();
  let matched = 0;
  for (const word of shorter) {
    let best = WORD_MATCH;
    let bestIndex = -1;
    for (const [index, other] of longer.entries()) {
      if (used.has(index)) continue;
      const score = characterSimilarity(word, other);
      if (score >= best) {
        best = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += 1;
    }
  }
  return matched / Math.max(leftWords.length, rightWords.length);
}

/**
 * How alike two titles are, 0–1: the *lower* of the character measure and the
 * word measure, so a title has to be close as a string **and** word by word.
 *
 * Exact-normalised equality is 1 by definition, so the scale is continuous
 * around the old rule rather than next to it.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normaliseTitle(a);
  const right = normaliseTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return Math.min(characterSimilarity(left, right), wordSimilarity(left, right));
}

/** What a provider row claims about itself — the query side of a match. */
export interface MatchSubject {
  title: string;
  /** The provider's year; null when it states none, which drops the term. */
  year?: number | null;
  /**
   * ISO-3166 alpha-2 codes, or the provider's own English names. The two are
   * reconciled in {@link countryMatches}; absence is normal (only some sources
   * state one, and only some rows carry it).
   */
  originCountry?: readonly string[] | null | undefined;
}

/** One row the match could land on. */
export interface MatchCandidate extends MatchSubject {
  /** Alternative titles the catalog carries (original language, aliases). */
  synonyms: readonly string[];
}

export interface MatchScore {
  /** 0–1: what the threshold is applied to. */
  score: number;
  /** The best title similarity, over the title and its synonyms. */
  title: number;
  /** 1 same year, 0.5 one out, 0.25 two; null when a side states none. */
  year: number | null;
  /** 1 agreed, 0 differed, null when either side states no country. */
  country: number | null;
}

const displayNames = (() => {
  let names: Intl.DisplayNames | null = null;
  return (): Intl.DisplayNames | null => {
    if (names === null) {
      try {
        names = new Intl.DisplayNames(['en'], { type: 'region' });
      } catch {
        // An ICU-less build: the code-or-name comparison below still works.
        names = null;
      }
    }
    return names;
  };
})();

export function normaliseCountry(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Spelled-out names where Letterboxd's wording and CLDR's disagree, plus the
 * abbreviations a person types. Legacy states (Soviet Union, Czechoslovakia)
 * are deliberately absent: their films sit under several modern codes, and a
 * guess here would be the coin flip this rule exists to avoid.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  'ivory coast': 'CI',
  'cape verde': 'CV',
  'czech republic': 'CZ',
  swaziland: 'SZ',
  macedonia: 'MK',
  burma: 'MM',
  'burma myanmar': 'MM',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'congo kinshasa': 'CD',
  'congo brazzaville': 'CG',
  palestine: 'PS',
  'palestinian territories': 'PS',
  turkey: 'TR',
  turkiye: 'TR',
  'united states of america': 'US',
  usa: 'US',
  us: 'US',
  uk: 'GB',
  'great britain': 'GB',
  'south korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  'russian federation': 'RU',
  iran: 'IR',
  'iran islamic republic of': 'IR',
  syria: 'SY',
  vietnam: 'VN',
  'viet nam': 'VN',
  laos: 'LA',
  moldova: 'MD',
  tanzania: 'TZ',
  venezuela: 'VE',
  bolivia: 'BO',
  kosovo: 'XK',
  taiwan: 'TW',
};

/** The spellings one side may use for one code: the code itself, its CLDR name, aliases. */
function countryForms(value: string): Set<string> {
  const forms = new Set<string>([normaliseCountry(value)]);
  const alias = COUNTRY_ALIASES[normaliseCountry(value)];
  if (alias) forms.add(normaliseCountry(alias));
  return forms;
}

/** The CLDR name of a two-letter code, or null when the runtime cannot say. */
function countryNameOf(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    const name = displayNames()?.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? normaliseCountry(name) : null;
  } catch {
    return null;
  }
}

/**
 * Do two country lists name the same place? `null` — not `false` — when either
 * side is silent, so the caller can drop the term instead of scoring a mismatch
 * it has no evidence for.
 */
export function countryMatches(
  subject: readonly string[] | null | undefined,
  candidate: readonly string[] | null | undefined,
): boolean | null {
  if (!subject?.length || !candidate?.length) return null;
  for (const wanted of subject) {
    const wantedForms = countryForms(wanted);
    for (const code of candidate) {
      const codeForms = countryForms(code);
      const name = countryNameOf(code);
      for (const form of wantedForms) {
        if (codeForms.has(form) || form === name) return true;
      }
    }
  }
  return false;
}

export function scoreMatch(subject: MatchSubject, candidate: MatchCandidate): MatchScore {
  const title = Math.max(
    0,
    ...[candidate.title, ...candidate.synonyms].map((other) =>
      titleSimilarity(subject.title, other),
    ),
  );
  const agreement = countryMatches(subject.originCountry, candidate.originCountry);
  const country = agreement === null ? null : agreement ? 1 : 0;
  const year = yearScore(subject.year ?? null, candidate.year ?? null);

  // Average over the signals both sides state: a row that carries no country is
  // not penalised for it, it simply has one term fewer.
  const weighted =
    TITLE_WEIGHT * title +
    (year === null ? 0 : YEAR_WEIGHT * year) +
    (country === null ? 0 : COUNTRY_WEIGHT * country);
  const total =
    TITLE_WEIGHT + (year === null ? 0 : YEAR_WEIGHT) + (country === null ? 0 : COUNTRY_WEIGHT);
  return { score: total === 0 ? 0 : weighted / total, title, year, country };
}

export interface RankedMatch<T extends MatchCandidate> {
  candidate: T;
  score: MatchScore;
}

/** The closest row an entry came to, kept even when it was not close enough. */
export interface NearestMatch {
  score: number;
  title: string;
}

export interface MatchDecision<T extends MatchCandidate> {
  best: RankedMatch<T>;
  /** Every candidate above the threshold, best first. */
  ranked: RankedMatch<T>[];
  /**
   * The top two are within {@link TIE_MARGIN}: the score does not choose, so
   * neither does the import.
   */
  ambiguous: boolean;
}

/** Every candidate, best first — the whole ranking, not only the winners. */
export function rankMatches<T extends MatchCandidate>(
  subject: MatchSubject,
  candidates: readonly T[],
): RankedMatch<T>[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreMatch(subject, candidate) }))
    .sort((a, b) => b.score.score - a.score.score);
}

/**
 * The best candidate above the threshold, or the pair that made it a tie.
 * `null` when nothing came within {@link MATCH_THRESHOLD}.
 */
export function chooseMatch<T extends MatchCandidate>(
  subject: MatchSubject,
  candidates: readonly T[],
): MatchDecision<T> | null {
  const ranked = rankMatches(subject, candidates).filter(
    ({ score }) => score.score > MATCH_THRESHOLD,
  );

  const [best, second] = ranked;
  if (!best) return null;
  return {
    best,
    ranked,
    ambiguous: second !== undefined && best.score.score - second.score.score <= TIE_MARGIN,
  };
}

/**
 * The closest candidate whether or not it cleared the threshold — what an
 * unmatched row is reported against, so "absent" and "79% short" are told apart.
 */
export function closestMatch<T extends MatchCandidate>(
  subject: MatchSubject,
  candidates: readonly T[],
): NearestMatch | null {
  const [first] = rankMatches(subject, candidates);
  return first ? { score: first.score.score, title: first.candidate.title } : null;
}

/** `originCountry` out of a catalog row's opaque `metadata` bag, or null. */
export function countriesOf(value: unknown): string[] | null {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : null;
  if (!Array.isArray(value)) return null;
  const codes = value.filter(
    (entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()),
  );
  return codes.length > 0 ? codes.map((code) => code.trim()) : null;
}
