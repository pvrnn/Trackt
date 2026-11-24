import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bestBanner,
  NON_WORK_GAME_TYPES,
  genreTag,
  isDisplayableReleaseStatus,
  parseArgs,
  uuidV5,
} from '../scrape.ts';

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

describe('the genre tags the seed writes', () => {
  it('turns IGDB names into the lowercase phrases the other importers write', () => {
    assert.equal(genreTag({ name: 'Role-Playing (RPG)' }), 'role playing');
    assert.equal(genreTag({ name: "Hack and slash/Beat 'em up" }), 'hack and slash beat em up');
    assert.equal(genreTag({ name: 'Card & Board Game' }), 'card and board game');
    assert.equal(genreTag({ name: 'Shooter' }), 'shooter');
    // Nothing left to print: fall back to the id, which is always a tag.
    assert.equal(genreTag({ name: '(RPG)', slug: 'role-playing-rpg' }), 'role-playing-rpg');
  });
});

describe('the release status the seed keeps', () => {
  it('drops the platform bookkeeping IGDB records as a release status', () => {
    assert.ok(isDisplayableReleaseStatus('Full Release'));
    assert.ok(isDisplayableReleaseStatus('Early Access'));
    assert.ok(!isDisplayableReleaseStatus('Next-Gen Optimization Patch Release'));
    assert.ok(!isDisplayableReleaseStatus('Digital Compatibility Release'));
    assert.ok(!isDisplayableReleaseStatus(undefined));
  });
});

describe('the banner', () => {
  // Hollow Knight: Silksong's artworks as IGDB returns them.
  const silksong = [
    { id: 1, image_id: 'ar41sh', width: 3539, height: 1795, artwork_type: 5, alpha_channel: true },
    { id: 2, image_id: 'ar41si', width: 3539, height: 1795, artwork_type: 6, alpha_channel: true },
    { id: 3, image_id: 'ar4prf', width: 1280, height: 720, artwork_type: 3 },
    { id: 4, image_id: 'ar4prg', width: 2289, height: 2212, artwork_type: 1 },
    { id: 5, image_id: 'ar4prh', width: 2400, height: 1350, artwork_type: 2 },
    { id: 6, image_id: 'ar4pri', width: 3840, height: 1240, artwork_type: 2 },
    { id: 7, image_id: 'ar667n', width: 256, height: 256, artwork_type: 12, alpha_channel: true },
  ];
  const shot = { id: 9, image_id: 'sc63aa', width: 1920, height: 1080 };

  it('takes the widest key art without a logo', () => {
    assert.equal(bestBanner(silksong, [shot]), 'ar4pri');
  });

  it('prefers a screenshot to key art carrying the logo', () => {
    assert.equal(bestBanner([silksong[2]!], [shot]), 'sc63aa');
    assert.equal(bestBanner([silksong[2]!], []), 'ar4prf');
  });

  it('never uses a logo, an icon, a square or an animated image', () => {
    const square = silksong[3]!;
    const animated = { ...silksong[5]!, animated: true };
    assert.equal(bestBanner([silksong[0]!, silksong[6]!, square, animated], []), null);
  });

  it('reads an artwork IGDB never typed as plain artwork', () => {
    assert.equal(bestBanner([{ id: 1, image_id: 'old', width: 1920, height: 1080 }], []), 'old');
  });
});
