import { describe, expect, it } from 'vitest';
import { externalProfiles } from '../src/external.js';

describe('externalProfiles', () => {
  it('points each known provider at its own page for the work', () => {
    expect(
      externalProfiles('anime', { anilist: 154587, mal: 52991, anidb: 17617, ann: 24850 }),
    ).toEqual([
      { provider: 'anilist', url: 'https://anilist.co/anime/154587' },
      { provider: 'mal', url: 'https://myanimelist.net/anime/52991' },
      { provider: 'anidb', url: 'https://anidb.net/anime/17617' },
      {
        provider: 'ann',
        url: 'https://www.animenewsnetwork.com/encyclopedia/anime.php?id=24850',
      },
    ]);
  });

  it('uses the print path for manga and the tv path for series', () => {
    expect(externalProfiles('manga', { anilist: 30001 })[0]?.url).toBe(
      'https://anilist.co/manga/30001',
    );
    expect(externalProfiles('series', { tmdb: 1396 })[0]?.url).toBe(
      'https://www.themoviedb.org/tv/1396',
    );
    expect(externalProfiles('movie', { tmdb: 603 })[0]?.url).toBe(
      'https://www.themoviedb.org/movie/603',
    );
  });

  it('keeps an unknown provider as a label with no link', () => {
    expect(externalProfiles('anime', { anilist: 1, syoboi: 42 })).toEqual([
      { provider: 'anilist', url: 'https://anilist.co/anime/1' },
      { provider: 'syoboi', url: null },
    ]);
  });

  it('tolerates an id stored as a string', () => {
    expect(externalProfiles('anime', { anilist: '19' })[0]?.url).toBe(
      'https://anilist.co/anime/19',
    );
  });

  it('uses the slug-based IGDB URL from provider metadata, not its numeric id', () => {
    expect(
      externalProfiles(
        'game',
        { igdb: 1942 },
        { igdbUrl: 'https://www.igdb.com/games/the-witcher-3-wild-hunt' },
      ),
    ).toEqual([{ provider: 'igdb', url: 'https://www.igdb.com/games/the-witcher-3-wild-hunt' }]);
    expect(externalProfiles('game', { igdb: 1942 })).toEqual([{ provider: 'igdb', url: null }]);
    expect(
      externalProfiles('game', { igdb: 1942 }, { igdbUrl: 'https://example.com/games/witcher' }),
    ).toEqual([{ provider: 'igdb', url: null }]);
  });

  it('links a Steam app id to its store page', () => {
    expect(externalProfiles('game', { igdb: 1942, steam: 292030 })).toEqual([
      { provider: 'igdb', url: null },
      { provider: 'steam', url: 'https://store.steampowered.com/app/292030' },
    ]);
  });
});
