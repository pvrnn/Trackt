import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NON_WORK_GAME_TYPES, parseArgs, uuidV5 } from '../scrape.ts';

/**
 * The seed mints its own ids because a scraper has no `@trackt/shared` to
 * import: the namespace and the `provider:kind:id` key are copied here, so a
 * drift in either would publish rows no instance can derive (ADR-0001).
 */

describe('the IGDB seed id', () => {
  it('derives the canonical game id every instance computes', () => {
    // Frozen forever, and shared with packages/shared/test/canonical-id.test.ts.
    assert.equal(uuidV5('igdb:game:55864'), 'b63ef2a5-7ab3-5a75-b9ec-a50a58a6831e');
  });

  it('is a v5 uuid', () => {
    const id = uuidV5('igdb:game:1');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, uuidV5('igdb:game:2'));
  });
});

describe('the walk arguments', () => {
  it('defaults to the size IGDB can fill at a meaningful vote floor', () => {
    const args = parseArgs([]);
    assert.equal(args.limit, 2_000);
    assert.equal(args.minRatingCount, 100);
    assert.equal(args.out, 'apps/catalog/seed/top-games-igdb.json');
  });

  it('takes an explicit size, floor and path', () => {
    const args = parseArgs(['--limit', '10', '--min-rating-count', '500', '--out', '/tmp/x.json']);
    assert.deepEqual(args, { limit: 10, minRatingCount: 500, out: '/tmp/x.json' });
  });

  it('refuses a size or floor that is not a number', () => {
    assert.throws(() => parseArgs(['--limit', 'many']), /--limit/);
    assert.throws(() => parseArgs(['--min-rating-count', '-1']), /--min-rating-count/);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  });
});

describe('the release types the seed skips', () => {
  it('skips mods, patches and episodic slices, and keeps editions and DLC', () => {
    // IGDB GameTypeEnum: 5 Mod, 6 Episode, 7 Season, 12 Fork, 13 Pack / Addon, 14 Update.
    for (const id of [5, 6, 7, 12, 13, 14]) assert.ok(NON_WORK_GAME_TYPES.has(id));
    // 0 Main Game, 2 Expansion, 3 Bundle, 4 Standalone Expansion, 8 Remake,
    // 9 Remaster, 10 Expanded Game, 11 Port — the parent graph groups these.
    for (const id of [0, 2, 3, 4, 8, 9, 10, 11]) assert.ok(!NON_WORK_GAME_TYPES.has(id));
  });
});
