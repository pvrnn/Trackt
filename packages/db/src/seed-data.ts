import { canonicalMediaId } from '@trackt/shared';
import type { media, mediaRelation } from './schema/media.js';

type MediaSeed = typeof media.$inferInsert;

/**
 * Derive each fixture's canonical id from the row itself (ADR-0005) rather than
 * restating the identity attributes beside it. Two reasons: a fixture can never
 * drift out of agreement with the publish guard, which recomputes the same key
 * from the same fields; and editing a title without editing its id — which would
 * mint a row the catalog would reject — becomes impossible.
 *
 * `id` may still be passed explicitly for user-created rows, which have no
 * derivable identity and keep a random UUID.
 */
const seed = (row: Omit<MediaSeed, 'id'> & { id?: string }): MediaSeed => ({
  ...row,
  id:
    row.id ??
    canonicalMediaId({
      kind: row.kind,
      title: row.title,
      year: row.year ?? null,
      seasonNumber: row.seasonNumber ?? null,
    }),
});

/**
 * Dev/test fixture catalog spanning every media kind, keyed by canonical IDs so the
 * rows match what the central catalog will publish for the same works (ADR-0001).
 *
 * Per ADR-0003 a series/anime "media" is a single season: Breaking Bad S1 and S2 are
 * two rows with distinct canonical IDs (`series:breaking bad:<year>:s<n>`), sharing
 * the show title so a search for "breaking bad" returns both, labelled by seasonNumber.
 * `partCount` is the one count (episodes or chapters); movies have none. The webtoon row
 * is user-created and keeps a fixed random UUID.
 *
 * Since ADR-0005 the `externalIds` on these rows are cross-references only — they no
 * longer take any part in deriving the ids above them.
 */
export const SEED_MEDIA: MediaSeed[] = [
  // Movies (identity provider: tmdb) — no parts.
  seed({
    kind: 'movie',
    title: 'The Matrix',
    slug: 'the-matrix-1999',
    synonyms: ['Matrix'],
    genres: ['action', 'science fiction'],
    year: 1999,
    releaseDate: '1999-03-31',
    status: 'ended',
    externalIds: { tmdb: 603, imdb: 'tt0133093' },
    description: 'A hacker learns the true nature of his reality.',
  }),
  seed({
    kind: 'movie',
    title: 'Interstellar',
    slug: 'interstellar-2014',
    synonyms: [],
    genres: ['adventure', 'drama', 'science fiction'],
    year: 2014,
    releaseDate: '2014-11-05',
    status: 'ended',
    externalIds: { tmdb: 157336, imdb: 'tt0816692' },
    description: 'Explorers travel through a wormhole in search of a new home for humanity.',
  }),
  seed({
    kind: 'movie',
    title: 'Spirited Away',
    slug: 'spirited-away-2001',
    synonyms: ['千と千尋の神隠し', 'Sen to Chihiro no Kamikakushi'],
    genres: ['animation', 'fantasy'],
    year: 2001,
    releaseDate: '2001-07-20',
    status: 'ended',
    externalIds: { tmdb: 129, imdb: 'tt0245429' },
    description: 'A girl wanders into a world of spirits and must free her parents.',
  }),
  // Series (identity provider: tmdb) — one row per season (ADR-0003).
  seed({
    kind: 'series',
    title: 'Breaking Bad',
    slug: 'breaking-bad-2008-s1',
    synonyms: [],
    genres: ['crime', 'drama'],
    year: 2008,
    releaseDate: '2008-01-20',
    status: 'ended',
    seasonNumber: 1,
    partCount: 7,
    externalIds: { tmdb: 1396, imdb: 'tt0903747', tvdb: 81189 },
    description: 'A chemistry teacher turns to manufacturing methamphetamine.',
  }),
  seed({
    kind: 'series',
    title: 'Breaking Bad',
    slug: 'breaking-bad-2009-s2',
    synonyms: [],
    genres: ['crime', 'drama'],
    year: 2009,
    releaseDate: '2009-03-08',
    status: 'ended',
    seasonNumber: 2,
    partCount: 13,
    externalIds: { tmdb: 1396, imdb: 'tt0903747', tvdb: 81189 },
    description: 'A chemistry teacher turns to manufacturing methamphetamine.',
  }),
  seed({
    kind: 'series',
    title: 'The Wire',
    slug: 'the-wire-2002-s1',
    synonyms: [],
    genres: ['crime', 'drama'],
    year: 2002,
    releaseDate: '2002-06-02',
    status: 'ended',
    seasonNumber: 1,
    partCount: 13,
    externalIds: { tmdb: 1438, imdb: 'tt0306414' },
    description: 'Baltimore through the eyes of drug dealers and law enforcement.',
  }),
  seed({
    kind: 'series',
    title: 'Severance',
    slug: 'severance-2022-s1',
    synonyms: [],
    genres: ['drama', 'mystery', 'science fiction'],
    year: 2022,
    releaseDate: '2022-02-17',
    status: 'ended',
    seasonNumber: 1,
    partCount: 9,
    externalIds: { tmdb: 95396, imdb: 'tt11280740' },
    description: 'Employees have their work and personal memories surgically divided.',
  }),
  seed({
    kind: 'series',
    title: 'Severance',
    slug: 'severance-2025-s2',
    synonyms: [],
    genres: ['drama', 'mystery', 'science fiction'],
    year: 2025,
    releaseDate: '2025-01-17',
    status: 'airing',
    seasonNumber: 2,
    partCount: 10,
    externalIds: { tmdb: 95396, imdb: 'tt11280740' },
    description: 'Employees have their work and personal memories surgically divided.',
  }),
  // Anime (identity provider: anilist) — AniList already issues one id per season/cour.
  seed({
    kind: 'anime',
    title: 'Cowboy Bebop',
    slug: 'cowboy-bebop-1998',
    synonyms: ['カウボーイビバップ'],
    genres: ['action', 'science fiction'],
    year: 1998,
    releaseDate: '1998-04-03',
    status: 'ended',
    seasonNumber: 1,
    partCount: 26,
    externalIds: { anilist: 1, mal: 1 },
    description: 'Bounty hunters drift through space aboard the Bebop.',
  }),
  seed({
    kind: 'anime',
    title: 'Frieren: Beyond Journey’s End',
    slug: 'frieren-beyond-journeys-end-2023',
    synonyms: ['葬送のフリーレン', 'Sousou no Frieren'],
    genres: ['adventure', 'drama', 'fantasy'],
    year: 2023,
    releaseDate: '2023-09-29',
    status: 'ended',
    seasonNumber: 1,
    partCount: 28,
    externalIds: { anilist: 154587, mal: 52991 },
    description: 'An elf mage outlives her companions and retraces their journey.',
  }),
  seed({
    kind: 'anime',
    title: 'Fullmetal Alchemist: Brotherhood',
    slug: 'fullmetal-alchemist-brotherhood-2009',
    synonyms: ['鋼の錬金術師 FULLMETAL ALCHEMIST', 'Hagane no Renkinjutsushi'],
    genres: ['action', 'adventure', 'fantasy'],
    year: 2009,
    releaseDate: '2009-04-05',
    status: 'ended',
    seasonNumber: 1,
    partCount: 64,
    externalIds: { anilist: 5114, mal: 5114 },
    description: 'Two brothers seek the Philosopher’s Stone to restore their bodies.',
  }),
  // Manga (identity provider: anilist) — whole work, counted in chapters.
  seed({
    // The source of the anime above — the fixture pair for a cross-kind
    // `adaptation` edge (ADR-0004), which reads as "source" from the anime side.
    kind: 'manga',
    title: 'Fullmetal Alchemist',
    slug: 'fullmetal-alchemist-2001',
    synonyms: ['鋼の錬金術師', 'Hagane no Renkinjutsushi', 'FMA'],
    genres: ['action', 'adventure', 'fantasy'],
    year: 2001,
    releaseDate: '2001-07-12',
    status: 'ended',
    partCount: 116,
    externalIds: { anilist: 30025, mal: 25 },
    description: 'Two alchemist brothers search for the Philosopher’s Stone.',
  }),
  seed({
    kind: 'manga',
    title: 'Berserk',
    slug: 'berserk-1989',
    synonyms: ['ベルセルク'],
    genres: ['action', 'dark fantasy'],
    year: 1989,
    releaseDate: '1989-08-25',
    status: 'publishing',
    partCount: 380,
    externalIds: { anilist: 30002, mal: 2 },
    description: 'A lone mercenary battles fate in a medieval dark-fantasy world.',
  }),
  seed({
    kind: 'manga',
    title: 'One Piece',
    slug: 'one-piece-1997',
    synonyms: ['ワンピース'],
    genres: ['action', 'adventure', 'comedy'],
    year: 1997,
    releaseDate: '1997-07-22',
    status: 'publishing',
    partCount: 1120,
    externalIds: { anilist: 30013, mal: 13 },
    description: 'Monkey D. Luffy sails to find the One Piece and become Pirate King.',
  }),
  seed({
    kind: 'manga',
    title: 'Chainsaw Man',
    slug: 'chainsaw-man-2018',
    synonyms: ['チェンソーマン'],
    genres: ['action', 'horror'],
    year: 2018,
    releaseDate: '2018-12-03',
    status: 'publishing',
    partCount: 180,
    externalIds: { anilist: 105778, mal: 116778 },
    description: 'A devil hunter merges with his chainsaw devil to survive.',
  }),
  // Webtoon — user-created: fixed random UUID (no identity provider for webtoons).
  seed({
    id: '7b0c6d3e-2f41-4a9d-9c1c-8f4d2a6b5e10',
    kind: 'webtoon',
    title: 'Cosmic Delivery Club',
    slug: 'cosmic-delivery-club',
    synonyms: [],
    genres: ['comedy', 'slice of life'],
    year: 2024,
    status: 'publishing',
    partCount: 47,
    externalIds: {},
    source: 'user',
    moderation: 'unverified',
    description: 'A fictional dev-seed webtoon about couriers who deliver across galaxies.',
  }),
];

/**
 * Look a fixture's canonical id up by slug. Relations reference rows by their
 * stable slug rather than re-deriving an id from title+year, so a fixture edit
 * can't leave an edge pointing at a work that no longer exists (ADR-0005 makes
 * ids move whenever an identity attribute changes, which the old provider-keyed
 * ids never did).
 */
export const seedId = (slug: string): string => {
  const row = SEED_MEDIA.find((m) => m.slug === slug);
  // `id` is optional on the insert type but `seed()` always fills it in.
  if (!row?.id) throw new Error(`No seed media with slug '${slug}'`);
  return row.id;
};

type MediaRelationSeed = typeof mediaRelation.$inferInsert;

/**
 * Relation fixtures (ADR-0004), all factually true — the dev seed is browsed by
 * humans, so adversarial cases (wrong types, soft-deleted targets, season 0)
 * belong in tests, not here.
 *
 * Stored one direction only; each row therefore exercises its reverse label too:
 * the adaptation reads as "source" from the anime side, and the sequel reads as
 * "prequel" from S2. Breaking Bad's seasons are deliberately *not* linked here —
 * they're the fixture proving season siblings derive with no stored edge at all.
 */
export const SEED_MEDIA_RELATIONS: MediaRelationSeed[] = [
  // Cross-kind: the manga is the source, the anime adapts it.
  {
    fromId: seedId('fullmetal-alchemist-2001'),
    toId: seedId('fullmetal-alchemist-brotherhood-2009'),
    type: 'adaptation',
  },
  // A stored series edge, so the stored path has coverage independent of derivation.
  {
    fromId: seedId('severance-2022-s1'),
    toId: seedId('severance-2025-s2'),
    type: 'sequel',
  },
  // Self-inverse: reads as `related` from both ends.
  {
    fromId: seedId('one-piece-1997'),
    toId: seedId('chainsaw-man-2018'),
    type: 'related',
  },
];
