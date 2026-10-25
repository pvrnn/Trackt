import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IDENTITY_PROVIDER_BY_KIND,
  MEDIA_KINDS,
  MEDIA_RELATION_TYPES,
  MEDIA_STATUSES,
  REFERENCE_VECTORS,
  TRACKT_CATALOG_NAMESPACE,
  assemblePayload,
  buildWork,
  canonicalMediaId,
  inferSeasonNumber,
  mapKind,
  mapStatus,
  normalizeGenres,
  parseArgs,
  resolveAniList,
  parseMalPage,
  planAdaptation,
  selfTest,
  splitRelationLabel,
  toSeedFile,
  mergeSeedFiles,
  toUrl,
  uuidv5,
} from '../scrape.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const fixture = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');

const FRIEREN = 'https://myanimelist.net/anime/52991/Sousou_no_Frieren';
const FMA = 'https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood';
const FRIEREN_MANGA = 'https://myanimelist.net/manga/126287/Sousou_no_Frieren';

describe('workspace drift guards', () => {
  const source = readFileSync(join(repo, 'packages/shared/src/canonical-id.ts'), 'utf8');
  const media = readFileSync(join(repo, 'packages/shared/src/media.ts'), 'utf8');

  it('uses the frozen catalog namespace', () => {
    const match = /TRACKT_CATALOG_NAMESPACE = '([0-9a-f-]+)'/.exec(source);
    assert.equal(match?.[1], TRACKT_CATALOG_NAMESPACE);
  });

  it('uses the same identity provider per kind', () => {
    for (const kind of MEDIA_KINDS) {
      const match = new RegExp(`\\b${kind}: '([a-z]+)'`).exec(
        /IDENTITY_PROVIDER_BY_KIND[\s\S]*?\};/.exec(source)?.[0] ?? '',
      );
      assert.equal(match?.[1] ?? null, IDENTITY_PROVIDER_BY_KIND[kind], kind);
    }
  });

  it('restates the shared enums exactly', () => {
    const list = (name: string) => {
      const block = new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(media);
      return block ? [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    };
    assert.deepEqual(list('MEDIA_KINDS'), [...MEDIA_KINDS]);
    assert.deepEqual(list('MEDIA_STATUSES'), [...MEDIA_STATUSES]);
    assert.deepEqual(list('MEDIA_RELATION_TYPES'), [...MEDIA_RELATION_TYPES]);
  });

  it('derives the frozen canonical ids', () => {
    selfTest();
    for (const vector of REFERENCE_VECTORS) {
      assert.equal(canonicalMediaId(vector.kind, vector.externalId), vector.id);
    }
  });

  it('matches the RFC 4122 uuidv5 vector', () => {
    assert.equal(
      uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'),
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('parseMalPage — anime', () => {
  const page = parseMalPage(fixture('anime-52991.html'), FRIEREN);

  it('identifies the work', () => {
    assert.equal(page.malId, 52991);
    assert.equal(page.malType, 'anime');
    assert.equal(page.format, 'TV');
    assert.equal(page.titleRomaji, 'Sousou no Frieren');
    assert.equal(page.titleEnglish, "Frieren: Beyond Journey's End");
    assert.equal(page.titleJapanese, '葬送のフリーレン');
    assert.deepEqual(page.synonyms.slice(0, 2), ['Frieren at the Funeral', 'Frieren The Slayer']);
  });

  it('reads the information block', () => {
    assert.equal(page.episodes, 28);
    assert.equal(page.chapters, null);
    assert.equal(page.status, 'Finished Airing');
    assert.equal(page.airedStart, '2023-09-29');
    assert.equal(page.airedEnd, '2024-03-22');
    assert.deepEqual(page.premiered, { season: 'fall', year: 2023 });
    assert.equal(page.source, 'Manga');
    assert.deepEqual(page.studios, ['Madhouse']);
    assert.ok(page.producers.includes('Aniplex'));
    assert.deepEqual(page.demographics, ['Shounen']);
  });

  it('keeps MAL chips out of the genre list but keeps the real ones', () => {
    assert.deepEqual(page.genres, ['Adventure', 'Award Winning', 'Drama', 'Fantasy']);
    assert.deepEqual(normalizeGenres(page.genres), ['adventure', 'drama', 'fantasy']);
  });

  it('reads the odd bits the catalog does not store', () => {
    assert.equal(page.score, 9.24);
    assert.equal(page.rank, 1);
    assert.equal(page.popularity, 95);
    assert.equal(page.members, 1534945);
    assert.ok(page.synopsis?.startsWith('During their decade-long quest'));
    assert.ok(page.background?.includes('Blu-ray'));
    assert.equal(page.coverUrl, 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg');
    assert.equal(page.broadcast, 'Fridays at 23:00 (JST)');
  });

  it('pulls the cross-provider ids out of the Resources block', () => {
    const names = page.externalLinks.map((link) => link.name);
    assert.ok(names.includes('AniDB'));
    assert.ok(names.includes('ANN'));
  });

  it('reads both the tile grid and the hidden table', () => {
    const labels = page.relations.map((ref) => `${ref.label}:${ref.malId}`);
    assert.ok(labels.includes('Sequel:59978'));
    assert.ok(labels.includes('Adaptation:126287'));
    assert.ok(labels.includes('Side Story:56885'));
    assert.equal(new Set(labels).size, labels.length, 'no duplicate relation');
  });
});

describe('parseMalPage — manga', () => {
  const page = parseMalPage(fixture('manga-126287.html'), FRIEREN_MANGA);

  it('reads a page whose headings and synopsis differ from the anime template', () => {
    assert.equal(page.format, 'Manga');
    assert.equal(page.chapters, 147);
    assert.equal(page.volumes, 15);
    assert.equal(page.status, 'On Hiatus');
    assert.equal(page.airedStart, '2020-04-28');
    assert.deepEqual(page.serialization, ['Shounen Sunday']);
    assert.deepEqual(page.authors, ['Yamada, Kanehito (Story)', 'Abe, Tsukasa (Art)']);
    // The synopsis is a <span> here, a <p> on anime pages.
    assert.ok(page.synopsis?.startsWith('The Demon King'));
    assert.ok(page.background?.includes('Kono Manga ga Sugoi'));
  });

  it('finds the anime adaptation from the manga side', () => {
    const adaptation = page.relations.find((ref) => ref.label === 'Adaptation');
    assert.equal(adaptation?.malId, 52991);
  });
});

describe('parseMalPage — alternative titles', () => {
  // MAL ends the block with a "More titles" toggle that sits in no row; a parser
  // that reads to the next row boundary glues it onto the last title (Steins;Gate).
  const html = `<html><head>
<meta property="og:title" content="Steins;Gate">
</head><body>
<h2>Alternative Titles</h2><div class="spaceit_pad">
    <span class="dark_text">Japanese:</span> STEINS;GATE
  </div><div class="js-alternative-titles hide"><div class="spaceit_pad">
        <span class="dark_text">English:</span> Steins;Gate
      </div>  </div>

  <a href="javascript:void(0);" class="viewOpEdMore js-anime-toggle-alternative-title-button">More titles</a><br /><br />

<h2>Information</h2>
<div class="spaceit_pad"><span class="dark_text">Type:</span> <a href="/topanime.php?type=tv">TV</a></div>
</body></html>`;

  it('stops a title at its own row, not at the next heading', () => {
    const page = parseMalPage(html, 'https://myanimelist.net/anime/9253/Steins_Gate');
    assert.equal(page.titleEnglish, 'Steins;Gate');
    assert.equal(page.titleJapanese, 'STEINS;GATE');
    assert.equal(page.format, 'TV');
  });
});

describe('parseMalPage — FMA:B', () => {
  const page = parseMalPage(fixture('anime-5114.html'), FMA);

  it('merges the single visible tile with the three table-only rows', () => {
    const seen = page.relations.map((ref) => `${ref.label}:${ref.malId}`);
    assert.deepEqual(seen, [
      'Adaptation:25',
      'Side Story:6421',
      'Side Story:9135',
      'Spin-Off:7902',
      'Alternative Version:121',
    ]);
  });

  it('flags only the rows MAL marks as hidden', () => {
    // The table lists every relation; `.hide-entry` marks the ones the page keeps
    // behind "More related entries". FMA:B renders three rows open and one hidden.
    const hidden = page.relations.filter((ref) => ref.hidden).map((ref) => ref.malId);
    assert.deepEqual(hidden, [121]);
  });
});

describe('catalog mapping', () => {
  it('maps MAL types to kinds, refusing what is not a work', () => {
    assert.deepEqual(mapKind('anime', 'TV'), { kind: 'anime' });
    assert.equal(mapKind('anime', 'Movie').kind, 'anime');
    assert.equal(mapKind('manga', 'Manhwa').kind, 'webtoon');
    assert.equal(mapKind('manga', 'Novel').kind, null);
    assert.equal(mapKind('anime', 'Music').kind, null);
  });

  it('maps statuses, letting the kind break the hiatus tie', () => {
    assert.equal(mapStatus('Finished Airing', 'anime'), 'ended');
    assert.equal(mapStatus('Currently Airing', 'anime'), 'airing');
    assert.equal(mapStatus('On Hiatus', 'anime'), 'airing');
    assert.equal(mapStatus('On Hiatus', 'manga'), 'publishing');
    assert.equal(mapStatus('Not yet aired', 'anime'), 'announced');
    assert.equal(mapStatus('Discontinued', 'manga'), 'cancelled');
    assert.equal(mapStatus('Something new', 'anime'), null);
  });

  it('normalises genre spellings across providers', () => {
    assert.deepEqual(normalizeGenres(['Sci-Fi', 'Award Winning', 'Action']), [
      'science fiction',
      'action',
    ]);
  });

  it('splits a MAL relation label off its format', () => {
    assert.deepEqual(splitRelationLabel('Sequel\n (TV)'), { label: 'Sequel', format: 'TV' });
    assert.deepEqual(splitRelationLabel('Side Story:'), { label: 'Side Story', format: null });
  });

  it('infers a season number from the title only when one is printed', () => {
    assert.equal(inferSeasonNumber('Sousou no Frieren 2nd Season'), 2);
    assert.equal(inferSeasonNumber('Some Show Season 3'), 3);
    assert.equal(inferSeasonNumber('Fullmetal Alchemist: Brotherhood'), null);
  });

  it('directions an adaptation by medium, not by which page was read', () => {
    assert.deepEqual(planAdaptation('manga', 'anime'), { direction: 'forward' });
    assert.deepEqual(planAdaptation('anime', 'manga'), { direction: 'reverse' });
    assert.ok('reason' in planAdaptation('anime', 'anime'));
  });
});

describe('buildWork', () => {
  const page = parseMalPage(fixture('anime-52991.html'), FRIEREN);

  it('drops licensed text and art by default', () => {
    const work = buildWork(page);
    assert.ok(!('skipped' in work));
    if ('skipped' in work) return;
    assert.equal(work.media.description, null);
    assert.equal(work.media.coverUrl, null);
    assert.equal(work.media.id, null, 'no canonical id without AniList');
  });

  it('maps the row the way the seed fixtures do', () => {
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    assert.equal(work.media.kind, 'anime');
    assert.equal(work.media.title, "Frieren: Beyond Journey's End");
    assert.equal(work.media.year, 2023);
    assert.equal(work.media.status, 'ended');
    assert.equal(work.media.partCount, 28);
    assert.equal(work.media.seasonNumber, 1);
    assert.deepEqual(work.media.synonyms.slice(0, 2), ['Sousou no Frieren', '葬送のフリーレン']);
    assert.deepEqual(work.media.genres, ['adventure', 'drama', 'fantasy']);
    assert.deepEqual(work.media.externalIds, { mal: 52991, anidb: 17617, ann: 26334 });
  });

  it('plans the adaptation edge from the manga, and the sequel forwards', () => {
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    const adaptation = work.relations.find((relation) => relation.type === 'adaptation');
    assert.equal(adaptation?.direction, 'reverse', 'this page is the screen side');
    assert.equal(adaptation?.target.malId, 126287);
    const sequel = work.relations.find((relation) => relation.type === 'sequel');
    assert.equal(sequel?.direction, 'forward');
    assert.equal(sequel?.target.malId, 59978);
  });

  it('records why Other entries were dropped instead of guessing', () => {
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    const skipped = work.skippedRelations.filter((entry) => entry.label === 'Other');
    assert.equal(skipped.length, 2, 'both music videos');
  });

  it('honours --season', () => {
    const work = buildWork(page, { seasonOverride: 3 });
    if ('skipped' in work) throw new Error(work.skipped);
    assert.equal(work.media.seasonNumber, 3);
  });

  it('honours --map for a label whose targets are trackable works', () => {
    const fma = parseMalPage(fixture('anime-5114.html'), FMA);
    const work = buildWork(fma, { relationOverrides: { 'side story': 'related' } });
    if ('skipped' in work) throw new Error(work.skipped);
    assert.deepEqual(
      work.relations.map((relation) => `${relation.type}:${relation.target.malId}`),
      ['adaptation:25', 'related:6421', 'related:9135', 'spinoff:7902', 'related:121'],
    );
  });
});

describe('payload and seed file', () => {
  const page = parseMalPage(fixture('anime-52991.html'), FRIEREN);
  const manga = parseMalPage(fixture('manga-126287.html'), FRIEREN_MANGA);
  const works = [page, manga].map((source) => {
    const work = buildWork(source);
    if ('skipped' in work) throw new Error(work.skipped);
    return work;
  });

  // The two real AniList records for these pages.
  const anilist = new Map([
    [
      'anime:52991',
      { id: 154587, idMal: 52991, title: { romaji: 'Sousou no Frieren' }, episodes: 28 },
    ],
    [
      'manga:126287',
      { id: 118586, idMal: 126287, title: { romaji: 'Sousou no Frieren' }, chapters: 147 },
    ],
    [
      'anime:59978',
      { id: 182255, idMal: 59978, title: { romaji: 'Sousou no Frieren 2nd Season' }, episodes: 28 },
    ],
  ]);

  const payload = assemblePayload(works, { anilist });

  it('derives the frozen id every instance computes for Frieren', () => {
    const row = payload.media.find((entry) => entry.kind === 'anime');
    assert.equal(row?.id, '70bad444-6129-517c-a705-40d0fd0327fc');
    assert.equal(row?.externalIds.anilist, 154587);
  });

  it('keeps one edge per pair and type', () => {
    const keys = payload.relations.map((edge) => `${edge.fromId}:${edge.toId}:${edge.type}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('never emits a self edge', () => {
    for (const edge of payload.relations) assert.notEqual(edge.fromId, edge.toId);
  });

  it('skips an edge whose target is a webtoon, which has no canonical identity', () => {
    const page = parseMalPage(fixture('anime-5114.html'), FMA);
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    // Pretend MAL listed a manhwa instead of the manga adaptation.
    work.relations = [
      {
        type: 'adaptation',
        direction: 'reverse',
        source: work.page,
        target: {
          malId: 4242,
          malType: 'manga',
          slug: 'Some_Manhwa',
          title: 'Some Manhwa',
          label: 'Adaptation',
          format: 'Manhwa',
          hidden: false,
          via: 'table',
        },
      },
    ];
    const payload = assemblePayload([work], {
      anilist: new Map([
        ['anime:5114', { id: 5114, idMal: 5114, title: {} }],
        ['manga:4242', { id: 999, idMal: 4242, title: {} }],
      ]),
    });
    assert.equal(payload.relations.length, 0, 'no edge without a canonical target id');
    assert.ok(payload.skipped.some((entry) => /webtoon.*no canonical identity/.test(entry.reason)));
  });

  it('carries per-page refusals into the report', () => {
    const reasons = payload.skipped.map((entry) => entry.reason);
    assert.ok(reasons.some((reason) => /music videos and ads/.test(reason)));
  });

  it('reports relation targets it could not resolve instead of dropping them silently', () => {
    const unresolved = payload.skipped.filter((entry) => /relation target/.test(entry.reason));
    assert.ok(unresolved.length > 0, 'Frieren sides stories have no AniList record here');
  });

  it('projects onto the two catalog tables', () => {
    const seed = toSeedFile(payload);
    assert.equal(seed.catalog_media.length, payload.media.length);
    assert.deepEqual(Object.keys(seed.catalog_media[0]!).sort(), [
      'bannerUrl',
      'coverUrl',
      'description',
      'externalIds',
      'genres',
      'id',
      'kind',
      'partCount',
      'seasonNumber',
      'status',
      'synonyms',
      'title',
      'year',
    ]);
    assert.deepEqual(Object.keys(seed.catalog_media_relation[0]!).sort(), [
      'fromId',
      'toId',
      'type',
    ]);
  });

  it('accumulates across runs without duplicating rows or edges', () => {
    const first = toSeedFile(payload);
    const merged = mergeSeedFiles(first, first);
    assert.equal(merged.catalog_media.length, first.catalog_media.length);
    assert.equal(merged.catalog_media_relation.length, first.catalog_media_relation.length);
  });
});

describe('seed rows match the catalog schema', () => {
  const schema = readFileSync(join(repo, 'apps/catalog/src/db/schema.ts'), 'utf8');

  /** Column property names of a pgTable block, from its object literal. */
  const columnsOf = (table: string): string[] => {
    const start = schema.indexOf(`${table} = pgTable(`);
    assert.ok(start > 0, `${table} not found in schema.ts`);
    const body = schema.slice(start, schema.indexOf('(t) => [', start));
    return [...body.matchAll(/^ {4}([a-zA-Z]+): /gm)].map((match) => match[1]!);
  };

  it('names only real catalog_media columns', () => {
    const declared = columnsOf('catalogMedia');
    assert.deepEqual(declared, [
      'id',
      'kind',
      'title',
      'synonyms',
      'year',
      'status',
      'genres',
      'partCount',
      'seasonNumber',
      'externalIds',
      'description',
      'coverUrl',
      'bannerUrl',
      'seq',
      'deletedAt',
      'createdAt',
      'updatedAt',
    ]);
    const page = parseMalPage(fixture('anime-5114.html'), FMA);
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    const seed = toSeedFile(
      assemblePayload([work], {
        anilist: new Map([['anime:5114', { id: 5114, idMal: 5114, title: {} }]]),
      }),
    );
    for (const key of Object.keys(seed.catalog_media[0]!)) {
      assert.ok(declared.includes(key), `seed writes unknown column ${key}`);
    }
    // The database assigns these; a seed file that carried them would be stale.
    for (const generated of ['seq', 'deletedAt', 'createdAt', 'updatedAt']) {
      assert.ok(!(generated in seed.catalog_media[0]!), `seed must not write ${generated}`);
    }
  });

  it('names only real catalog_media_relation columns', () => {
    const declared = columnsOf('catalogMediaRelation');
    assert.deepEqual(declared, ['fromId', 'toId', 'type', 'createdAt']);
    const page = parseMalPage(fixture('anime-5114.html'), FMA);
    const work = buildWork(page);
    if ('skipped' in work) throw new Error(work.skipped);
    const seed = toSeedFile(
      assemblePayload([work], {
        anilist: new Map([['anime:5114', { id: 5114, idMal: 5114, title: {} }]]),
      }),
    );
    for (const row of seed.catalog_media_relation) {
      assert.deepEqual(Object.keys(row).sort(), ['fromId', 'toId', 'type']);
      for (const key of Object.keys(row)) assert.ok(declared.includes(key));
    }
  });
});

describe('AniList resolution', () => {
  /** A fake AniList that 404s any query containing an unknown or mistyped id. */
  function fakeAniList(
    options: { unknown?: number[]; animeOnlyMissing?: number[]; withLocations?: boolean } = {},
  ) {
    const unknown = new Set(options.unknown ?? []);
    const mistyped = new Set(options.animeOnlyMissing ?? []);
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const { query } = JSON.parse(init.body) as { query: string };
      const aliases = [...query.matchAll(/a(\d+): Media\(idMal: (\d+), type: (ANIME|MANGA)/g)].map(
        ([, alias, id, type]) => ({ alias: alias!, malId: Number(id), type: type! }),
      );
      calls.push(aliases.map((entry) => entry.malId).join(','));
      const bad = aliases.some(
        (entry) =>
          unknown.has(entry.malId) || (mistyped.has(entry.malId) && entry.type === 'ANIME'),
      );
      if (bad) {
        const culprit = aliases.find(
          (entry) =>
            unknown.has(entry.malId) || (mistyped.has(entry.malId) && entry.type === 'ANIME'),
        )!;
        const line = aliases.indexOf(culprit) + 2;
        return new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Not Found.',
                status: 404,
                // Real AniList names the offending alias by line in the query.
                locations: options.withLocations ? [{ line, column: 1 }] : undefined,
              },
            ],
            data: null,
          }),
          { status: 404 },
        );
      }
      const data = Object.fromEntries(
        aliases.map((entry) => [
          `a${entry.alias}`,
          { id: 100_000 + entry.malId, idMal: entry.malId, title: {} },
        ]),
      );
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('bisects a batch instead of losing 19 ids to one unknown', async () => {
    const fake = fakeAniList({ unknown: [3] });
    const refs = [1, 2, 3, 4].map((malId) => ({ malType: 'anime' as const, malId }));
    const found = await resolveAniList(refs, {
      fetchImpl: fake.fetchImpl,
      delayMs: 0,
      spacingMs: 0,
      batchSize: 4,
    });
    assert.deepEqual([...found.keys()].sort(), ['anime:1', 'anime:2', 'anime:4']);
    assert.ok(fake.calls.length > 1, 'the 404 batch was split');
  });

  it('drops the alias AniList names instead of bisecting the batch', async () => {
    const fake = fakeAniList({ unknown: [3], withLocations: true });
    const refs = [1, 2, 3, 4].map((malId) => ({ malType: 'anime' as const, malId }));
    const found = await resolveAniList(refs, {
      fetchImpl: fake.fetchImpl,
      delayMs: 0,
      spacingMs: 0,
      batchSize: 4,
    });
    assert.deepEqual([...found.keys()].sort(), ['anime:1', 'anime:2', 'anime:4']);
    // batch(4) 404 → rest(3) 200, culprit(1) 404 → flip(1) 404. No bisection.
    assert.equal(fake.calls.length, 4);
  });

  it('retries a mistyped id under the other medium', async () => {
    const fake = fakeAniList({ animeOnlyMissing: [7] });
    const found = await resolveAniList([{ malType: 'anime', malId: 7 }], {
      fetchImpl: fake.fetchImpl,
      delayMs: 0,
      spacingMs: 0,
    });
    assert.equal(found.get('anime:7')?.id, 100_007, 'stored under the key the caller asked for');
  });

  it('gives up on an id neither medium knows, without failing the run', async () => {
    const warnings: string[] = [];
    const fake = fakeAniList({ unknown: [9] });
    const found = await resolveAniList([{ malType: 'anime', malId: 9 }], {
      fetchImpl: fake.fetchImpl,
      delayMs: 0,
      spacingMs: 0,
      onWarn: (message) => warnings.push(message),
    });
    assert.equal(found.size, 0);
    assert.match(warnings.join('\n'), /no entry for MAL anime 9/);
  });

  it('waits out a rate limit instead of throwing', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts++;
      if (attempts === 1) return new Response('slow down', { status: 429 });
      return new Response(JSON.stringify({ data: { a0: { id: 5, idMal: 1, title: {} } } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const found = await resolveAniList([{ malType: 'anime', malId: 1 }], {
      fetchImpl,
      delayMs: 0,
      spacingMs: 0,
    });
    assert.equal(found.get('anime:1')?.id, 5);
    assert.equal(attempts, 2);
  });
});

describe('cli', () => {
  it('builds a URL from a bare id and a type', () => {
    assert.equal(toUrl('5114', 'anime'), 'https://myanimelist.net/anime/5114');
    assert.throws(() => toUrl('5114'), /--type/);
    assert.throws(() => toUrl('https://example.com/anime/1'), /not a MyAnimeList/);
  });

  it('parses the flags that change what gets published', () => {
    const options = parseArgs([
      'https://myanimelist.net/anime/5114/x',
      '--anilist',
      '--season',
      '2',
      '--map',
      'other=related,character=related',
      '--merge',
      'seed.json',
    ]);
    assert.equal(options.anilist, true);
    assert.equal(options.season, 2);
    assert.deepEqual(options.relationOverrides, { other: 'related', character: 'related' });
    assert.equal(options.merge, 'seed.json');
  });

  it('rejects an unknown relation type', () => {
    assert.throws(() => parseArgs(['5114', '--map', 'other=prequel']), /--map type/);
  });
});
