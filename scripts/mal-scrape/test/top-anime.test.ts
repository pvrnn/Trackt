import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IdentityCache,
  PAGE_SIZE,
  clock,
  emptyState,
  limitForRank,
  listUrl,
  parseState,
  parseTopAnimePage,
  parseTopAnimeRow,
  parseTopArgs,
  seedToPayload,
  walkRanking,
  type RunState,
  type TopOptions,
  type WalkDeps,
} from '../top-anime.ts';
import { type AniListRecord, type SeedFile, parseMalPage } from '../scrape.ts';

const here = dirname(fileURLToPath(import.meta.url));
const list = readFileSync(join(here, 'fixtures', 'topanime-limit0.html'), 'utf8');
const detailHtml = readFileSync(join(here, 'fixtures', 'anime-52991.html'), 'utf8');

const options = (overrides: Partial<TopOptions> = {}): TopOptions => ({
  ...parseTopArgs([]),
  delayMs: 0,
  ...overrides,
});

/** A list page whose rows point at arbitrary MAL ids, in the same markup. */
function listPage(rows: { rank: number; malId: number; format: string }[]): string {
  return rows
    .map(
      (row) => `<tr class="ranking-list">
    <td class="rank ac"><span class="lightLink top-anime-rank-text rank${row.rank}">${row.rank}</span></td>
    <td class="title al va-t word-break">
      <div class="detail"><div class="di-ib clearfix">
        <h3 class="fl-l fs14 fw-b anime_ranking_h3"><a href="https://myanimelist.net/anime/${row.malId}/Work_${row.malId}">Work ${row.malId}</a></h3>
      </div><br><div class="information di-ib mt4">${row.format} (12 eps)<br>Jan 2020 - Mar 2020<br>1,000 members</div></div>
    </td>
    <td class="score ac fs14"><div class="js-top-ranking-score-col"><span class="text on score-label score-8">8.00</span></div></td>
  </tr>`,
    )
    .join('\n');
}

describe('the ranking table', () => {
  const entries = parseTopAnimePage(list);

  it('reads every row of a captured page', () => {
    assert.equal(entries.length, 6);
    assert.deepEqual(
      entries.map((entry) => entry.rank),
      [1, 5, 9, 11, 15, 50],
    );
  });

  it('identifies the first work, its link and its statistics', () => {
    assert.deepEqual(entries[0], {
      rank: 1,
      malId: 52991,
      url: 'https://myanimelist.net/anime/52991/Sousou_no_Frieren',
      title: 'Sousou no Frieren',
      format: 'TV',
      episodes: 28,
      members: 1535892,
      score: 9.24,
    });
  });

  it('keeps multi-word formats intact', () => {
    const formats = entries.map((entry) => entry.format);
    assert.deepEqual(formats, ['TV', 'Movie', 'ONA', 'OVA', 'TV Special', 'TV']);
  });

  it('tolerates a row MAL renders without a link or a rank', () => {
    assert.equal(parseTopAnimeRow('<tr class="ranking-list"><td></td></tr>'), null);
  });

  it('reads a manga row from the same markup as an anime one', () => {
    // topmanga.php shares the ranking-table markup; only the information line
    // differs (`Manga (42 vols)` instead of `TV (28 eps)`).
    const row = `<tr class="ranking-list">
      <td class="rank ac"><span class="lightLink top-anime-rank-text rank1">1</span></td>
      <td class="title al va-t clearfix word-break"><div class="detail">
        <h3 class="manga_h3"><a class="hoverinfo_trigger fs14 fw-b" href="https://myanimelist.net/manga/2/Berserk">Berserk</a></h3>
        <div class="information di-ib mt4">Manga (? vols)<br>Aug 1989 - <br>813,004 members</div>
      </div></td>
      <td class="score ac fs14"><span class="text on score-label score-9">9.46</span></td>
    </tr>`;
    const [entry] = parseTopAnimePage(row);
    assert.equal(entry?.rank, 1);
    assert.equal(entry?.malId, 2);
    assert.equal(entry?.title, 'Berserk');
    assert.equal(entry?.format, 'Manga');
    assert.equal(entry?.score, 9.46);
    // A volume count is not an episode count; chapters come from AniList.
    assert.equal(entry?.episodes, null);
  });

  it("walks MAL's manga ranking when asked for manga", () => {
    assert.equal(listUrl(0, 'manga'), 'https://myanimelist.net/topmanga.php?limit=0');
    assert.equal(listUrl(50, 'anime'), 'https://myanimelist.net/topanime.php?limit=50');
  });

  it('pages by 50 and maps a rank onto its page', () => {
    assert.equal(PAGE_SIZE, 50);
    assert.equal(listUrl(0), 'https://myanimelist.net/topanime.php?limit=0');
    assert.equal(limitForRank(1), 0);
    assert.equal(limitForRank(50), 0);
    assert.equal(limitForRank(51), 50);
    assert.equal(limitForRank(10000), 9950);
  });
});

describe('options', () => {
  it('defaults to the whole ranking, all trackable formats', () => {
    const parsed = parseTopArgs([]);
    assert.equal(parsed.maxRank, 10000);
    assert.equal(parsed.fromRank, 1);
    assert.equal(parsed.out, 'apps/catalog/seed/top-anime.json');
    assert.equal(parsed.statePath, 'apps/catalog/seed/top-anime.json.state.json');
    assert.ok(parsed.types.has('tv') && parsed.types.has('tv special'));
    assert.ok(!parsed.types.has('music'));
  });

  it('parses a bounded run', () => {
    const parsed = parseTopArgs(['--max-rank', '120', '--from-rank', '100', '--types', 'TV,Movie']);
    assert.equal(parsed.maxRank, 120);
    assert.equal(parsed.fromRank, 100);
    assert.deepEqual([...parsed.types], ['tv', 'movie']);
  });

  it('rejects a range that makes no sense', () => {
    assert.throws(
      () => parseTopArgs(['--from-rank', '200', '--max-rank', '100']),
      /past --max-rank/,
    );
    assert.throws(() => parseTopArgs(['--max-rank', '0']), /positive integer/);
    assert.throws(() => parseTopArgs(['--nope']), /unknown option/);
  });
});

describe('identity cache', () => {
  it('restores ids from the state file without a query', async () => {
    const cache = new IdentityCache({ 'anime:52991': 154587 });
    assert.equal(cache.get('anime', 52991)?.id, 154587);
    let called = 0;
    const resolver = async () => {
      called++;
      return new Map<string, AniListRecord>();
    };
    const cached = new IdentityCache({ 'anime:52991': 154587 }, { resolver });
    // A relation target only needs the id, so a cached one is enough.
    await cached.ensure([{ malType: 'anime', malId: 52991 }]);
    assert.equal(called, 0);
    // A row being written needs the fields, so an id-only record is refreshed.
    await cached.ensure([{ malType: 'anime', malId: 52991 }], {
      needsFull: new Set(['anime:52991']),
    });
    assert.equal(called, 1);
  });

  it('remembers what AniList refused, so the next page does not ask again', async () => {
    let called = 0;
    const resolver = async (refs: { malType: string; malId: number }[]) => {
      called++;
      // Nothing resolves: every one of these ids is genuinely absent.
      return new Map<string, AniListRecord>(
        refs.map((ref) => [`${ref.malType}:${ref.malId}`, null as never]).filter(() => false),
      );
    };
    const cache = new IdentityCache({}, { resolver: resolver as never });
    await cache.ensure([{ malType: 'manga', malId: 53273 }]);
    await cache.ensure([{ malType: 'manga', malId: 53273 }]);
    assert.equal(called, 1, 'the second call is served from the negative cache');
    assert.deepEqual(cache.toMissingJSON(), ['manga:53273']);
    assert.equal(cache.isMissing('manga', 53273), true);

    // The negative cache survives a restart.
    const restored = new IdentityCache(
      {},
      { missing: cache.toMissingJSON(), resolver: resolver as never },
    );
    await restored.ensure([{ malType: 'manga', malId: 53273 }]);
    assert.equal(called, 1);
  });

  it('round-trips through its serialised form', () => {
    const cache = new IdentityCache({ 'anime:1': 10, 'manga:2': 20 });
    assert.deepEqual(cache.toJSON(), { 'anime:1': 10, 'manga:2': 20 });
  });
});

describe('state', () => {
  it('tolerates a truncated or foreign state file', () => {
    const parsed = parseState(
      '{"nextLimit": 100, "done": [1, "x", 2], "resolved": {"anime:1": 5}}',
    );
    assert.equal(parsed.nextLimit, 100);
    assert.deepEqual(parsed.done, [1, 2]);
    assert.deepEqual(parsed.resolved, { 'anime:1': 5 });
    assert.deepEqual(parsed.failed, {});
    assert.deepEqual(parsed.skipped, {});
  });

  it('formats elapsed time', () => {
    assert.equal(clock(9_000), '9s');
    assert.equal(clock(90_000), '1m30s');
    assert.equal(clock(3_723_000), '1h02m');
  });
});

describe('walkRanking', () => {
  /** Two list pages: ids 1 and 2 resolve, 3 errors, 4 is a Music entry, 5 resolves. */
  const pages: Record<number, string> = {
    0: listPage([
      { rank: 1, malId: 1, format: 'TV' },
      { rank: 2, malId: 2, format: 'TV' },
    ]),
    50: listPage([
      { rank: 51, malId: 3, format: 'TV' },
      { rank: 52, malId: 4, format: 'Music' },
      { rank: 53, malId: 5, format: 'TV' },
    ]),
  };

  function deps(overrides: Partial<WalkDeps> = {}) {
    const calls: string[] = [];
    const seedWrites: SeedFile[] = [];
    const states: RunState[] = [];
    let stored: RunState | null = null;
    const resolver = async (refs: { malType: string; malId: number }[]) => {
      const map = new Map<string, AniListRecord>();
      for (const ref of refs)
        map.set(`${ref.malType}:${ref.malId}`, { id: 1000 + ref.malId, title: {} });
      return map;
    };
    const value: WalkDeps = {
      fetchHtml: async (url) => {
        calls.push(url);
        if (url.includes('topanime.php')) {
          const limit = Number(new URL(url).searchParams.get('limit'));
          if (!(limit in pages)) throw new Error(`unexpected page ${limit}`);
          return pages[limit]!;
        }
        if (url.includes('/anime/3/')) throw new Error('MAL 404 for /anime/3/');
        return detailHtml;
      },
      readSeed: async () => null,
      readState: async () => stored,
      writeSeed: async (_path, seed) => {
        seedWrites.push(seed);
      },
      writeState: async (_path, state) => {
        stored = state;
        states.push(state);
      },
      log: () => {},
      resolveAniList: resolver as never,
      ...overrides,
    };
    return {
      value,
      calls,
      seedWrites,
      states,
      get stored() {
        return stored;
      },
    };
  }

  it('walks the pages in order and records what it did', async () => {
    const fake = deps();
    const result = await walkRanking(options({ maxRank: 100 }), fake.value);

    assert.deepEqual(
      fake.calls.filter((url) => !url.includes('topanime.php')),
      [
        'https://myanimelist.net/anime/1/Work_1',
        'https://myanimelist.net/anime/2/Work_2',
        'https://myanimelist.net/anime/3/Work_3',
        'https://myanimelist.net/anime/5/Work_5',
      ],
      'the Music row is filtered before its detail page is fetched',
    );
    assert.equal(result.pages, 2);
    assert.equal(result.scraped, 3);
    assert.equal(result.failed, 1);
    assert.equal(result.filtered, 1);
    assert.deepEqual(result.state.done, [1, 2, 5]);
    assert.match(result.state.failed['3']!, /MAL 404/);
    assert.equal(result.state.nextLimit, 100);
    assert.equal(result.seed.catalog_media.length, 3);
    // Both works share one adaptation target in the fixture; edges dedupe.
    assert.ok(result.seed.catalog_media_relation.length > 0);
  });

  it('writes the seed after every page, so a crash loses at most one page', async () => {
    const fake = deps();
    await walkRanking(options({ maxRank: 100 }), fake.value);
    assert.equal(fake.seedWrites.length, 2, 'one write per page that produced rows');
    assert.equal(fake.seedWrites.at(-1)!.catalog_media.length, 3);
  });

  it('resumes where it stopped instead of refetching', async () => {
    const first = deps();
    await walkRanking(options({ maxRank: 100 }), first.value);
    const state = first.stored!;

    const second = deps({ readState: async () => state, readSeed: async () => null });
    const result = await walkRanking(options({ maxRank: 100 }), second.value);
    assert.deepEqual(second.calls, [], 'nothing left to fetch');
    assert.equal(result.pages, 0);
    assert.equal(result.scraped, 0);
  });

  it('replays a failed entry with --retry-failed, and only that entry', async () => {
    const first = deps();
    await walkRanking(options({ maxRank: 100 }), first.value);

    const second = deps({ readState: async () => first.stored!, readSeed: async () => null });
    const result = await walkRanking(options({ maxRank: 100, retryFailed: true }), second.value);
    assert.deepEqual(
      second.calls.filter((url) => url.includes('/anime/')),
      ['https://myanimelist.net/anime/3/Work_3'],
      'the two finished works are skipped, the failed one is retried',
    );
    assert.equal(result.failed, 1, 'it fails again');
  });

  it('starts over with --restart', async () => {
    const first = deps();
    await walkRanking(options({ maxRank: 100 }), first.value);
    const second = deps({ readState: async () => first.stored! });
    await walkRanking(options({ maxRank: 100, restart: true }), second.value);
    assert.equal(second.calls.filter((url) => url.includes('/anime/2/')).length >= 1, true);
  });

  it('honours --from-rank by starting on the right page and skipping earlier rows', async () => {
    const fake = deps();
    const result = await walkRanking(options({ fromRank: 51, maxRank: 100 }), fake.value);
    assert.equal(fake.calls[0], listUrl(50));
    assert.equal(result.pages, 1);
  });

  it('dry-run lists without fetching details or writing', async () => {
    const fake = deps();
    const result = await walkRanking(options({ maxRank: 100, dryRun: true }), fake.value);
    assert.equal(result.planned.length, 4, 'music filtered');
    assert.deepEqual(
      fake.calls.filter((url) => url.includes('/anime/')),
      [],
    );
    assert.equal(fake.seedWrites.length, 0);
  });

  it('does not mark a page done when --max-rank ends inside it', async () => {
    // A 2-row page under a --max-rank of 1: rank 2 must still be reachable by a
    // later, wider run.
    const fake = deps();
    const result = await walkRanking(options({ maxRank: 1 }), fake.value);
    assert.equal(result.state.done.length, 1);
    assert.equal(result.state.nextLimit, 0, 'the half-covered page is not skipped');

    const wider = deps({ readState: async () => result.state });
    const resumed = await walkRanking(options({ maxRank: 2 }), wider.value);
    assert.deepEqual(resumed.state.done.sort(), [1, 2]);
  });

  it('aborts instead of marking thousands of entries failed when the site blocks it', async () => {
    const blockedPage = listPage(
      [1, 2, 3, 4, 5, 6].map((malId, index) => ({ rank: index + 1, malId, format: 'TV' })),
    );
    const failing = deps({
      fetchHtml: async (url) => {
        if (url.includes('topanime.php')) return blockedPage;
        throw new Error('MAL 403 for ' + url);
      },
    });
    await assert.rejects(
      walkRanking(options({ maxRank: 100 }), failing.value),
      /consecutive failures/,
    );
  });

  it('stops when the ranking returns no rows', async () => {
    const fake = deps({ fetchHtml: async () => listPage([]) });
    const result = await walkRanking(options({ maxRank: 100 }), fake.value);
    assert.equal(result.pages, 0);
  });

  it('hands the seed file back in its publish shape', async () => {
    const fake = deps();
    const result = await walkRanking(options({ maxRank: 100 }), fake.value);
    const payload = seedToPayload(result.seed);
    assert.equal(payload.media.length, 3);
    assert.equal(payload.relations.length, result.seed.catalog_media_relation.length);
    assert.equal(payload.relations[0]!.from, undefined, 'provenance is optional');
  });
});

describe('detail pages reused from the single-page scraper', () => {
  it('parses the fixture the walk feeds it', () => {
    const page = parseMalPage(detailHtml, 'https://myanimelist.net/anime/1/Work_1');
    assert.equal(page.malId, 1, 'identity comes from the URL, not the markup');
    assert.equal(page.episodes, 28);
  });

  it('starts from an empty state', () => {
    assert.deepEqual(emptyState(), {
      nextLimit: 0,
      done: [],
      failed: {},
      skipped: {},
      resolved: {},
      missing: [],
    });
  });
});
