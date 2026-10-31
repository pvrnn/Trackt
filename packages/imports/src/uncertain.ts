import type { ImportMatchOrigin } from '@trackt/db';
import type { MatchCandidate, RankedMatch } from './match.js';

/**
 * What an import could not decide, kept so the viewer can.
 *
 * Two shapes of "not sure": the best candidate scored in the uncertain band
 * (above {@link UNCERTAIN_FLOOR}, below the match threshold), or two candidates
 * scored so alike that the tie margin refused them. Both are stored with the
 * rows behind them, because the only person who knows which *Cobweb* they
 * watched is the one who watched it.
 */

/** Below this, the candidates are noise: "not in the catalog", not "which one?". */
export const UNCERTAIN_FLOOR = 0.5;

/** A picker is a shortlist, not the catalogue; the top of the ranking is enough. */
export const MAX_UNCERTAIN_CANDIDATES = 5;

/**
 * How far below the best a candidate may sit and still be offered. The floor
 * says "these are all plausible"; this says "these are all *about as* plausible"
 * — a 0.98 next to a 0.62 is one real candidate and one word in common, and a
 * picker that shows both teaches the viewer to ignore it.
 */
export const UNCERTAIN_SPREAD = 0.15;

export interface UncertainCandidate {
  /** `media.id` here, or the central catalog's canonical id. */
  id: string;
  title: string;
  year: number | null;
  /** 0–1, from `scoreMatch`. */
  score: number;
  origin: ImportMatchOrigin;
}

export interface UncertainMatch {
  /** `tie` when several rows scored alike, `below-threshold` when one was close. */
  outcome: 'tie' | 'below-threshold';
  candidates: UncertainCandidate[];
}

/**
 * The shortlist from a ranking: everything above the floor, best first, capped.
 * `null` when nothing cleared it — that entry is simply absent, and a picker
 * with nothing to pick would be a dead end.
 */
export function uncertainFrom<T extends MatchCandidate & { id: string }>(
  ranked: readonly RankedMatch<T>[],
  origin: ImportMatchOrigin,
  tie: boolean,
): UncertainMatch | null {
  const best = ranked[0]?.score.score ?? 0;
  const candidates = ranked
    .filter(({ score }) => score.score > UNCERTAIN_FLOOR && score.score >= best - UNCERTAIN_SPREAD)
    .slice(0, MAX_UNCERTAIN_CANDIDATES)
    .map(({ candidate, score }) => ({
      id: candidate.id,
      title: candidate.title,
      year: candidate.year ?? null,
      score: score.score,
      origin,
    }));
  if (candidates.length === 0) return null;
  return { outcome: tie ? 'tie' : 'below-threshold', candidates };
}

/**
 * Two resolvers answer the same entry (this instance, then the central
 * catalog). Keep both shortlists, deduplicated by id, best first.
 */
export function mergeUncertain(
  first: UncertainMatch | null | undefined,
  second: UncertainMatch | null | undefined,
): UncertainMatch | null {
  if (!first) return second ?? null;
  if (!second) return first;
  const byId = new Map<string, UncertainCandidate>();
  for (const candidate of [...first.candidates, ...second.candidates]) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.score > existing.score) byId.set(candidate.id, candidate);
  }
  const best = Math.max(...[...byId.values()].map((candidate) => candidate.score));
  return {
    outcome: first.outcome === 'tie' || second.outcome === 'tie' ? 'tie' : 'below-threshold',
    candidates: [...byId.values()]
      .filter((candidate) => candidate.score >= best - UNCERTAIN_SPREAD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_UNCERTAIN_CANDIDATES),
  };
}
