import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TYPES,
  assignSeasonNumbers,
  clock,
  importAniListMedia,
  meaningfulDescription,
  mapAniListKind,
  mapAniListStatus,
  parseFromAniListArgs,
  planEdges,
  rowFromMedia,
  walkImport,
  type FromAniListOptions,
} from '../from-anilist.ts';
import {
  createAniListClient,
  cooldownMs,
  mediaByMalIdsQuery,
  mediaFields,
  type AniListMedia,
  type AniListPage,
} from '../anilist.ts';
import {
  IDENTITY_PROVIDER_BY_KIND,
  MEDIA_KINDS,
  type SeedFile,
  canonicalMediaId,
  mergeSeedFiles,
  providerUrl,
} from '../scrape.ts';

const here = dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(readFileSync(join(here, 'fixtures', 'anilist-media.json'), 'utf8')) as {
  data: { Page: AniListPage<AniListMedia> };
};
const frieren = payload.data.Page.media.find((media) => media.id === 154587)!;
const fmab = payload.data.Page.media.find((media) => media.id === 5114)!;

describe('mapping an AniList record', () => {
  it('derives the same canonical id the MAL scraper computes', () => {
    const { row } = rowFromMedia(frieren);
    assert.equal(row?.id, canonicalMediaId('anime', 154587));
    assert.equal(row?.id, '70bad444-6129-517c-a705-40d0fd0327fc');
  });

  it('fills the row the way the MAL path does', () => {
    const { row } = rowFromMedia(frieren);
    assert.equal(row?.kind, 'anime');
    // AniList carries a typographic apostrophe where MAL has an ASCII one; the
    // provider's own text is kept rather than normalised.
    assert.equal(row?.title, 'Frieren: Beyond Journey’s End');
    assert.equal(row?.year, 2023);
    assert.equal(row?.status, 'ended');
    assert.equal(row?.partCount, 28);
    assert.equal(row?.seasonNumber, null, 'filled from the sequel chain, not guessed');
    assert.deepEqual(row?.genres.slice(0, 3), ['adventure', 'drama', 'fantasy']);
    assert.ok(row?.synonyms.includes('葬送のフリーレン'));
  });

  it('keeps only the ids AniList actually states', () => {
    // AniList exposes no AniDB/ANN ids — its externalLinks are streaming and
    // official-site links whose `siteId` is AniList's own registry key.
    const { row } = rowFromMedia(frieren);
    assert.deepEqual(row?.externalIds, { anilist: 154587, mal: 52991 });
  });

  it('flattens AniList markup into plain prose when the synopsis is asked for', () => {
    const media = {
      ...frieren,
      description: 'Line one.<br>Line <i>two</i> with <b>emphasis</b> &amp; entities.\n\nThird.',
    };
    const { row } = rowFromMedia(media, { withDescription: true });
    assert.equal(row?.description, 'Line one.\n\nLine two with emphasis & entities.\n\nThird.');
    assert.equal(rowFromMedia(frieren, { withDescription: false }).row?.description, null);
  });

  it('drops a provider placeholder instead of storing it as prose', () => {
    const { row } = rowFromMedia({ ...frieren, description: 'N/A' }, { withDescription: true });
    assert.equal(row?.description, null);
    assert.equal(meaningfulDescription('-'), null);
    assert.equal(meaningfulDescription('   '), null);
    assert.equal(meaningfulDescription('A real synopsis.'), 'A real synopsis.');
  });

  it('includes the cover by default and the synopsis never unless asked', () => {
    const { row } = rowFromMedia(frieren, { withCover: true });
    assert.match(row?.coverUrl ?? '', /^https:\/\/s4\.anilist\.co\/file\/anilistcdn\//);
    assert.equal(row?.description, null);
  });

  it('carries the banner by default, unlike the fields that must be opted into', () => {
    const bannerImage = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-x.jpg';
    const withBanner = rowFromMedia({ ...frieren, bannerImage });
    assert.equal(withBanner.row?.bannerUrl, bannerImage);
    assert.equal(
      rowFromMedia({ ...frieren, bannerImage }, { withBanner: false }).row?.bannerUrl,
      null,
    );
    // Most manga have no banner at all; the detail page falls back to the cover.
    assert.equal(rowFromMedia(frieren).row?.bannerUrl, null);
  });

  it('maps kinds and refuses what is not a work', () => {
    assert.equal(mapAniListKind('ANIME', 'TV').kind, 'anime');
    assert.equal(mapAniListKind('ANIME', 'MOVIE').kind, 'anime');
    assert.equal(mapAniListKind('ANIME', 'MUSIC').kind, null);
    assert.equal(mapAniListKind('MANGA', 'MANGA').kind, 'manga');
    assert.equal(mapAniListKind('MANGA', 'NOVEL').kind, null);
    assert.equal(mapAniListKind('MANGA', 'MANHWA').kind, 'webtoon');
    // Only webtoons lack an identity provider, so only they cannot be identified.
    for (const kind of MEDIA_KINDS) {
      assert.equal(Boolean(IDENTITY_PROVIDER_BY_KIND[kind]), kind !== 'webtoon');
    }
  });

  it('maps statuses, letting the kind break the hiatus tie', () => {
    assert.equal(mapAniListStatus('FINISHED', 'anime'), 'ended');
    assert.equal(mapAniListStatus('RELEASING', 'manga'), 'airing');
    assert.equal(mapAniListStatus('HIATUS', 'anime'), 'airing');
    assert.equal(mapAniListStatus('HIATUS', 'manga'), 'publishing');
    assert.equal(mapAniListStatus('CANCELLED', 'anime'), 'cancelled');
    assert.equal(mapAniListStatus('NOT_YET_RELEASED', 'anime'), 'announced');
  });

  it('builds the provider URL a client can redirect to', () => {
    assert.equal(providerUrl('anime', { anilist: 154587 }), 'https://anilist.co/anime/154587');
    assert.equal(providerUrl('manga', { anilist: 118586 }), 'https://anilist.co/manga/118586');
    assert.equal(providerUrl('series', { tmdb: 1396 }), 'https://www.themoviedb.org/tv/1396');
    assert.equal(providerUrl('webtoon', {}), null);
  });
});

describe('edges from AniList relations', () => {
  it('orients the manga adaptation and the sequel', () => {
    const plans = planEdges(frieren, 'anime');
    const edges = plans.filter((plan) => plan.ok).map((plan) => plan.edge);
    const animeId = canonicalMediaId('anime', 154587);
    const mangaId = canonicalMediaId('manga', 118586);
    assert.ok(
      edges.some(
        (edge) => edge.fromId === mangaId && edge.toId === animeId && edge.type === 'adaptation',
      ),
    );
    assert.ok(
      edges.some(
        (edge) =>
          edge.fromId === animeId &&
          edge.toId === canonicalMediaId('anime', 182255) &&
          edge.type === 'sequel',
      ),
    );
  });

  it('emits every target as its own row, so edges are publishable', () => {
    const plans = planEdges(frieren, 'anime');
    for (const plan of plans) {
      if (!plan.ok) continue;
      assert.ok(plan.target?.id, 'a target row with a canonical id');
      // The catalog rejects an edge whose endpoint is not a media row.
      assert.equal(
        plan.target!.id,
        plan.edge.fromId === plan.target?.id ? plan.edge.fromId : plan.target!.id,
      );
    }
  });

  it('reports the music videos and character entries instead of guessing', () => {
    const plans = planEdges(frieren, 'anime');
    const skipped = plans.filter((plan) => !plan.ok).map((plan) => plan.skipped.reason);
    assert.ok(skipped.some((reason) => /music videos and ads/.test(reason)));
    assert.ok(skipped.some((reason) => /character compilation/.test(reason)));
  });

  it('never emits a self edge, and keys a symmetric `related` once', () => {
    const plans = planEdges(frieren, 'anime');
    for (const plan of plans) {
      if (!plan.ok) continue;
      assert.notEqual(plan.edge.fromId, plan.edge.toId);
      if (plan.edge.type === 'related') assert.ok(plan.edge.fromId < plan.edge.toId);
    }
  });

  it('dedupes a page into rows and edges', () => {
    const page = importAniListMedia([frieren, fmab]);
    assert.equal(new Set(page.media.map((row) => row.id)).size, page.media.length);
    assert.equal(
      new Set(page.edges.map((edge) => `${edge.fromId}:${edge.toId}:${edge.type}`)).size,
      page.edges.length,
    );
    assert.ok(page.media.length > 2, 'relation targets are rows too');
  });
});

describe('season numbers from the sequel chain', () => {
  const row = (id: number, kind: 'anime' = 'anime') => ({
    id: canonicalMediaId(kind, id),
    kind,
    title: `Work ${id}`,
    synonyms: [],
    year: null,
    status: null,
    genres: [],
    partCount: null,
    seasonNumber: 1 as number | null,
    externalIds: { anilist: id },
    description: null,
    coverUrl: null,
    bannerUrl: null,
  });
  const seed = (ids: number[], edges: [number, number][]): SeedFile => ({
    generatedAt: '2026-01-01T00:00:00.000Z',
    catalog_media: ids.map((id) => row(id)),
    catalog_media_relation: edges.map(([from, to]) => ({
      fromId: canonicalMediaId('anime', from),
      toId: canonicalMediaId('anime', to),
      type: 'sequel',
    })),
    report: { sources: [], skipped: [], warnings: [] },
  });
  const seasonOf = (file: SeedFile, id: number) =>
    file.catalog_media.find((entry) => entry.id === canonicalMediaId('anime', id))?.seasonNumber;

  it('numbers a sequel chain 1, 2, 3', () => {
    const file = seed(
      [10, 20, 30],
      [
        [10, 20],
        [20, 30],
      ],
    );
    const changed = assignSeasonNumbers(file);
    assert.deepEqual([seasonOf(file, 10), seasonOf(file, 20), seasonOf(file, 30)], [1, 2, 3]);
    assert.equal(changed, 2, 'the first was already 1');
  });

  it('takes the deepest predecessor for a split cour', () => {
    // 40 is both a sequel of 10 and of 20, which is itself a sequel of 10.
    const file = seed(
      [10, 20, 40],
      [
        [10, 20],
        [20, 40],
        [10, 40],
      ],
    );
    assignSeasonNumbers(file);
    assert.equal(seasonOf(file, 40), 3);
  });

  it('leaves an unconnected work at 1 and survives a cycle', () => {
    const file = seed(
      [1, 2, 3],
      [
        [1, 2],
        [2, 1],
      ],
    );
    assignSeasonNumbers(file);
    assert.equal(seasonOf(file, 3), 1);
    assert.ok((seasonOf(file, 1) ?? 0) >= 1);
  });

  it('assigns nothing to a manga', () => {
    const file = seed([7], []);
    file.catalog_media.push({ ...row(7), kind: 'manga', id: canonicalMediaId('manga', 7) });
    assignSeasonNumbers(file);
    const manga = file.catalog_media.find((entry) => entry.kind === 'manga');
    assert.equal(manga?.seasonNumber, 1);
  });
});

describe('the client', () => {
  it('spaces requests and counts them', async () => {
    const calls: number[] = [];
    const client = createAniListClient({
      spacingMs: 60,
      fetchImpl: (async () => {
        calls.push(Date.now());
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await client.query('query { a }');
    await client.query('query { b }');
    assert.equal(client.requestCount(), 2);
    assert.ok(calls[1]! - calls[0]! >= 55, 'second request waited');
  });

  it('waits out a 429 and retries', async () => {
    let attempts = 0;
    const client = createAniListClient({
      spacingMs: 0,
      fetchImpl: (async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
        }
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const body = await client.query<{ ok: boolean }>('query { a }');
    assert.equal(body.data?.ok, true);
    assert.equal(attempts, 2);
  });

  it('throws on a real error instead of looping', async () => {
    const client = createAniListClient({
      spacingMs: 0,
      fetchImpl: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
    });
    await assert.rejects(client.query('query { a }'), /AniList 400/);
  });

  it('honours Retry-After, capped', () => {
    const response = new Response('', { status: 429, headers: { 'retry-after': '2' } });
    assert.equal(cooldownMs(response, 1, 2000), 2000);
    const forever = new Response('', { status: 429, headers: { 'retry-after': '10000' } });
    assert.equal(cooldownMs(forever, 1, 2000), 300_000);
  });

  it('asks for descriptions only when told to', () => {
    assert.ok(!mediaFields().includes('description'));
    assert.ok(mediaFields({ withDescription: true }).includes('description'));
    assert.match(mediaByMalIdsQuery(mediaFields()), /idMal_in/);
  });
});

describe('the walk', () => {
  const listPage = (ids: number[]) =>
    ids
      .map(
        (malId, index) => `<tr class="ranking-list">
      <td class="rank ac"><span class="lightLink top-anime-rank-text rank${index + 1}">${index + 1}</span></td>
      <td class="title al va-t word-break"><div class="detail"><div class="di-ib clearfix">
        <h3 class="fl-x fs14 fw-b anime_ranking_h3"><a href="https://myanimelist.net/anime/${malId}/x">Work ${malId}</a></h3>
      </div><br><div class="information di-ib mt4">TV (12 eps)<br>1 members</div></div></td>
      <td class="score ac fs14"><span class="text on score-label score-8">8.0</span></td>
    </tr>`,
      )
      .join('\n');

  const options = (overrides: Partial<FromAniListOptions> = {}): FromAniListOptions => ({
    ...parseFromAniListArgs([]),
    delayMs: 0,
    ...overrides,
  });

  function deps() {
    const written: SeedFile[] = [];
    const queried: string[] = [];
    const client = createAniListClient({
      spacingMs: 0,
      fetchImpl: (async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { variables: { ids?: number[] } };
        queried.push((body.variables.ids ?? []).join(','));
        return new Response(
          JSON.stringify({
            data: {
              Page: {
                pageInfo: { hasNextPage: false, total: 2, currentPage: 1, lastPage: 1 },
                media: [frieren, fmab],
              },
            },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    return {
      client,
      queried,
      written,
      deps: {
        client,
        fetchHtml: async () => listPage([52991, 5114]),
        readSeed: async () => null,
        writeSeed: async (_path: string, seed: SeedFile) => {
          written.push(seed);
        },
        log: () => {},
      },
    };
  }

  it('resolves a MAL ranking page through idMal_in and writes the seed', async () => {
    const fake = deps();
    const result = await walkImport(options({ maxRank: 2 }), fake.deps);
    assert.deepEqual(fake.queried, ['52991,5114'], 'one AniList request per 50 MAL ids');
    assert.equal(fake.written.length, 1);
    const seed = fake.written[0]!;
    assert.ok(seed.catalog_media.some((row) => row.id === canonicalMediaId('anime', 154587)));
    assert.ok(seed.urls?.[canonicalMediaId('anime', 154587)] === 'https://anilist.co/anime/154587');
    assert.ok(seed.catalog_media.every((row) => row.id !== null));
    assert.equal(result.rows, seed.catalog_media.length);
  });

  it('numbers seasons from the edges it just wrote', async () => {
    const fake = deps();
    await walkImport(options({ maxRank: 2 }), fake.deps);
    const seed = fake.written.at(-1)!;
    const frierenRow = seed.catalog_media.find(
      (row) => row.id === canonicalMediaId('anime', 154587),
    );
    assert.equal(frierenRow?.seasonNumber, 1);
    const sequel = seed.catalog_media.find((row) => row.id === canonicalMediaId('anime', 182255));
    assert.equal(sequel?.seasonNumber, 2, 'S2 is a sequel row, so the chain numbers it');
  });

  it('folds into an existing seed instead of replacing it', async () => {
    const fake = deps();
    const existing: SeedFile = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      catalog_media: [
        {
          id: canonicalMediaId('anime', 1),
          kind: 'anime',
          title: 'Cowboy Bebop',
          synonyms: [],
          year: 1998,
          status: 'ended',
          genres: [],
          partCount: 26,
          seasonNumber: 1,
          externalIds: { anilist: 1 },
          description: null,
          coverUrl: null,
          bannerUrl: null,
        },
      ],
      catalog_media_relation: [],
      urls: {},
      report: { sources: [], skipped: [], warnings: [] },
    };
    fake.deps.readSeed = async () => existing;
    await walkImport(options({ maxRank: 2 }), fake.deps);
    assert.ok(fake.written.at(-1)!.catalog_media.some((row) => row.title === 'Cowboy Bebop'));
  });

  it('defaults to MAL ordering but AniList facts', () => {
    const parsed = parseFromAniListArgs([]);
    assert.equal(parsed.source, 'mal-ranking');
    assert.equal(parsed.withCover, true);
    assert.deepEqual([...parsed.types], DEFAULT_TYPES);
    assert.equal(
      parseFromAniListArgs(['--source', 'anilist', '--sort', 'popularity_desc']).sort,
      'POPULARITY_DESC',
    );
    assert.equal(parseFromAniListArgs(['--without-cover']).withCover, false);
    assert.equal(parseFromAniListArgs(['--without-banner']).withBanner, false);
    assert.throws(() => parseFromAniListArgs(['--source', 'nope']), /--source/);
  });

  it('formats elapsed time', () => {
    assert.equal(clock(9_000), '9s');
    assert.equal(clock(90_000), '1m30s');
  });

  it('merges url maps', () => {
    const a: SeedFile = {
      generatedAt: '',
      catalog_media: [],
      catalog_media_relation: [],
      urls: { x: 'u1' },
      report: { sources: [], skipped: [], warnings: [] },
    };
    const b: SeedFile = {
      generatedAt: '',
      catalog_media: [],
      catalog_media_relation: [],
      urls: { y: 'u2' },
      report: { sources: [], skipped: [], warnings: [] },
    };
    assert.deepEqual(mergeSeedFiles(a, b).urls, { x: 'u1', y: 'u2' });
  });
});
