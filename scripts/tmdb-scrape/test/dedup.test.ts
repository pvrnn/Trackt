import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDuplicate,
  mergeIntoAnime,
  normaliseTitle,
  pairSeeds,
  replaceRows,
  sequelNumber,
  titleStem,
  type SeedRow,
} from '../dedup.ts';

const row = (over: Partial<SeedRow>): SeedRow => ({
  id: over.id ?? 'id',
  kind: over.kind ?? 'anime',
  title: over.title ?? 'Some Work',
  synonyms: over.synonyms ?? [],
  year: over.year ?? 2020,
  status: over.status ?? 'ended',
  genres: over.genres ?? ['animation'],
  partCount: over.partCount ?? null,
  seasonNumber: over.seasonNumber ?? null,
  externalIds: over.externalIds ?? { anilist: 1 },
  metadata: over.metadata ?? { format: 'movie', providerScore: 80 },
  description: over.description ?? null,
  coverUrl: over.coverUrl ?? null,
  bannerUrl: over.bannerUrl ?? null,
});

const movie = (over: Partial<SeedRow> = {}) =>
  row({
    kind: 'movie',
    genres: ['animation'],
    metadata: { format: 'movie', runtime: 100 },
    ...over,
  });

const show = (over: Partial<SeedRow> = {}) =>
  row({ kind: 'series', genres: ['animation'], partCount: 12, seasonNumber: 1, ...over });

const animeShow = (over: Partial<SeedRow> = {}) =>
  row({ kind: 'anime', partCount: 12, seasonNumber: 1, metadata: { format: 'tv' }, ...over });

describe('the title normalisation', () => {
  it('ignores case, accent and punctuation differences', () => {
    assert.equal(normaliseTitle("Chang'An"), normaliseTitle('Changan'));
    assert.equal(normaliseTitle('Les Misérables'), 'les miserables');
    assert.equal(normaliseTitle('The  King’s Avatar!'), 'the kings avatar');
  });
});

describe('the sequel a title numbers', () => {
  it('strips a trailing number so "… 2" meets season 2 of "…"', () => {
    assert.equal(titleStem('Cyberpunk: Edgerunners 2'), 'cyberpunk edgerunners');
    assert.equal(titleStem('Full-Time Magister S2'), 'full time magister');
    assert.equal(titleStem('Sword of Coming 2nd Season'), 'sword of coming');
    assert.equal(titleStem('Cyberpunk: Edgerunners'), 'cyberpunk edgerunners');
  });

  it('reads the number a title carries', () => {
    assert.equal(sequelNumber('Cyberpunk: Edgerunners 2'), 2);
    assert.equal(sequelNumber('Cyberpunk: Edgerunners'), null);
    assert.equal(sequelNumber('Steins;Gate 0'), 0);
    assert.equal(sequelNumber('Full-Time Magister S2'), 2);
    assert.equal(sequelNumber('Sword of Coming 2nd Season'), 2);
  });

  it('pairs a season with the follow-up AniList names in the title', () => {
    const anime = row({
      id: 'a2',
      title: 'Cyberpunk: Edgerunners 2',
      year: 2026,
      partCount: 10,
      metadata: { format: 'ona' },
    });
    const season = row({
      id: 's2',
      kind: 'series',
      title: 'Cyberpunk: Edgerunners',
      year: 2026,
      partCount: 10,
      seasonNumber: 2,
      genres: ['animation'],
      metadata: { format: 'tv' },
    });
    const { pairs } = pairSeeds([anime], [season]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.anime.id, 'a2');
  });
});

describe('what counts as a duplicate', () => {
  it('pairs an animated film with an anime film of the same year', () => {
    assert.equal(isDuplicate(movie({ year: 2021 }), row({ year: 2021 })), true);
  });

  it('pairs a season with an anime of the same episode count', () => {
    assert.equal(isDuplicate(show({ year: 2024 }), animeShow({ year: 2024 })), true);
  });

  it('tolerates one year of drift, and a couple of episodes either way', () => {
    assert.equal(isDuplicate(movie({ year: 2018 }), row({ year: 2017 })), true);
    assert.equal(isDuplicate(show({ partCount: 13 }), animeShow({ partCount: 12 })), true);
  });

  it('never folds a live-action adaptation into the anime it adapts', () => {
    // Death Note (2006 film) is not the 2006 anime, however identical the title and year.
    const liveAction = movie({ genres: ['fantasy', 'thriller'] });
    assert.equal(isDuplicate(liveAction, animeShow({ partCount: 37 })), false);
  });

  it('never pairs a season with a manga entry that shares its title', () => {
    assert.equal(
      isDuplicate(show(), animeShow({ metadata: { format: 'manga' }, partCount: 165 })),
      false,
    );
  });

  it('refuses a season that covers several anime cours', () => {
    // Soul Land: one TMDB season of 264 episodes is not the 26-episode AniList cour.
    assert.equal(isDuplicate(show({ partCount: 264 }), animeShow({ partCount: 26 })), false);
  });

  it('refuses a film matched to a series, or a year that is two apart', () => {
    assert.equal(isDuplicate(movie(), animeShow()), false);
    assert.equal(isDuplicate(movie({ year: 2020 }), row({ year: 2022 })), false);
  });

  it('accepts an untagged animation only when the synopses agree', () => {
    const cg = show({
      genres: ['action'],
      description: 'A colony fights for survival against an army of mobile suits',
    });
    const anime = animeShow({
      description: 'A colony survives an army of mobile suits in a brutal war',
    });
    assert.equal(isDuplicate(cg, anime), true);
    assert.equal(isDuplicate({ ...cg, description: 'Something else entirely' }, anime), false);
  });
});

describe('the pairing', () => {
  it('gives one anime row to one TMDB row even when several seasons match it', () => {
    const anime = animeShow({ id: 'anime-1', title: 'Sword of Coming', year: 2024, partCount: 26 });
    const firstSeason = show({ id: 's1', title: 'Sword of Coming', year: 2024, partCount: 26 });
    const secondSeason = show({
      id: 's2',
      title: 'Sword of Coming',
      year: 2025,
      partCount: 27,
      seasonNumber: 2,
    });
    const { pairs } = pairSeeds([anime], [secondSeason, firstSeason]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.tmdb.id, 's1');
    assert.equal(pairs[0]!.anime.id, 'anime-1');
  });

  it('matches on a synonym, and reports what it refused to pair', () => {
    const anime = row({
      id: 'a1',
      title: 'Legend of Deification',
      synonyms: ['Jiang Ziya'],
      year: 2020,
    });
    const matched = movie({ id: 'm1', title: 'Jiang Ziya', year: 2020 });
    const liveAction = movie({ id: 'm2', title: 'Jiang Ziya', year: 2020, genres: ['drama'] });
    const { pairs, skipped } = pairSeeds([anime], [matched, liveAction]);
    assert.deepEqual(
      pairs.map((pair) => pair.tmdb.id),
      ['m1'],
    );
    assert.deepEqual(
      skipped.map((entry) => entry.tmdb.id),
      ['m2'],
    );
  });

  it('leaves a row that already absorbed a TMDB season alone', () => {
    // Re-running over deduplicated seeds must not fold the next season into the same row.
    const taken = animeShow({
      id: 'a1',
      title: 'Scissor Seven',
      year: 2018,
      metadata: { format: 'ona', tmdb: { id: 79141, seasonNumber: 1 } },
    });
    const secondSeason = show({ id: 's2', title: 'Scissor Seven', year: 2019, seasonNumber: 2 });
    const { pairs } = pairSeeds([taken], [secondSeason]);
    assert.deepEqual(pairs, []);
  });

  it('ignores manga rows in the anime seed entirely', () => {
    const manga = row({ id: 'manga-1', kind: 'manga', title: 'Same Title', year: 2020 });
    const { pairs, skipped } = pairSeeds([manga], [movie({ title: 'Same Title', year: 2020 })]);
    assert.deepEqual(pairs, []);
    assert.deepEqual(skipped, []);
  });
});

describe('the rows a merge rewrites', () => {
  it('patches the row in every seed that carries it, and leaves the others alone', () => {
    // The manga seed ships copies of the anime it adapts; both must carry the merge.
    const stale: SeedRow = row({ id: 'a1', title: 'Green Snake', externalIds: { anilist: 1 } });
    const merged = mergeIntoAnime(stale, movie({ externalIds: { tmdb: 795607 } }));
    const untouched: SeedRow = row({ id: 'a2', title: 'Other' });
    const patched = replaceRows([stale, untouched], new Map([['a1', merged]]));
    assert.equal(patched[0], merged);
    assert.equal(patched[1], untouched);
  });
});

describe('the merge into the AniList row', () => {
  const anime = row({
    id: 'a1',
    title: 'Green Snake',
    externalIds: { anilist: 130190, mal: 49409 },
    metadata: { format: 'movie', providerScore: 73 },
    coverUrl: null,
  });
  const tmdb = movie({
    title: 'Green Snake',
    externalIds: { tmdb: 795607, imdb: 'tt15000314' },
    metadata: { format: 'movie', providerScore: 81, ratingCount: 398, runtime: 132 },
    coverUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
  });

  it('keeps the AniList identity, score and format', () => {
    const merged = mergeIntoAnime(anime, tmdb);
    assert.equal(merged.id, 'a1');
    assert.equal(merged.externalIds.anilist, 130190);
    assert.equal(merged.metadata.providerScore, 73);
    assert.equal(merged.metadata.format, 'movie');
  });

  it('carries the TMDB ids and facts, nested so neither score shadows the other', () => {
    const merged = mergeIntoAnime(anime, tmdb);
    assert.deepEqual(merged.externalIds, {
      anilist: 130190,
      mal: 49409,
      tmdb: 795607,
      imdb: 'tt15000314',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facts = merged.metadata.tmdb as any;
    assert.equal(facts.id, 795607);
    assert.equal(facts.runtime, 132);
    assert.equal(facts.providerScore, 81);
  });

  it('fills a missing image but never replaces one', () => {
    assert.equal(mergeIntoAnime(anime, tmdb).coverUrl, 'https://image.tmdb.org/t/p/w500/x.jpg');
    assert.equal(
      mergeIntoAnime({ ...anime, coverUrl: 'anilist.jpg' }, tmdb).coverUrl,
      'anilist.jpg',
    );
  });
});
