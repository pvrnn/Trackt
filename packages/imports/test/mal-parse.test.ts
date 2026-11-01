import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFavorites } from '../src/mal/parse.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/mal/${name}`, import.meta.url), 'utf8');
}

describe('parseFavorites', () => {
  it('reads titles as printed, entities and all', () => {
    const { items } = parseFavorites(fixture('favorites.html'));
    expect(items.map((item) => item.title)).toEqual([
      'NHK ni Youkoso!',
      'Fullmetal Alchemist: Brotherhood',
      'Yotsuba&!',
    ]);
  });

  it('carries the year printed beside the format', () => {
    const { items } = parseFavorites(fixture('favorites.html'));
    expect(items.map((item) => item.year)).toEqual([2006, 2009, 2003]);
  });

  it('does not mistake characters for works', () => {
    const { items } = parseFavorites(fixture('favorites.html'));
    expect(items.some((item) => item.externalId === '17')).toBe(false);
  });

  it('decodes both named and numeric entities', () => {
    const html = `
      <h5>Manga</h5>
      <div class="boxlist-container manga mb16">
        <div class="boxlist col-4">
          <div class="di-tc va-t pl8 data">
            <div class="title"><a href="/manga/1/x">Caf&#233; &#x26; Bar</a></div>
            <div class="di-ib mt4 fn-grey2">Manga ･ 1999</div>
          </div>
        </div>
      </div>`;
    expect(parseFavorites(html).items).toEqual([
      { kind: 'manga', externalId: '1', title: 'Café & Bar', year: 1999 },
    ]);
  });

  it('a one-shot with no year is a favourite with a null year, not a dropped row', () => {
    const html = `
      <h5>Anime</h5>
      <div class="boxlist-container anime mb16">
        <div class="boxlist col-4">
          <div class="di-tc va-t pl8 data">
            <div class="title"><a href="/anime/9/x">Special</a></div>
            <div class="di-ib mt4 fn-grey2">Special ･ ?</div>
          </div>
        </div>
      </div>`;
    expect(parseFavorites(html).items).toEqual([
      { kind: 'anime', externalId: '9', title: 'Special', year: null },
    ]);
  });

  it('counts the sections it found, so a missing one is not "no favourites"', () => {
    expect(parseFavorites('<html><body>nope</body></html>')).toEqual({ items: [], sections: 0 });
    expect(parseFavorites(fixture('favorites.html')).sections).toBe(2);
  });
});
