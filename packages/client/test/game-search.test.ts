import { describe, expect, it } from 'vitest';
import { gameSearchContext, groupGameSearchResults } from '../src/game-search.js';

const hit = (
  id: string,
  title: string,
  metadata: Record<string, unknown> = {},
  kind: 'game' | 'anime' = 'game',
) => ({
  id,
  slug: id,
  kind,
  title,
  year: null,
  status: null,
  seasonNumber: null,
  coverUrl: null,
  description: null,
  metadata,
});

describe('gameSearchContext', () => {
  it('describes an expansion with its parent game', () => {
    expect(
      gameSearchContext('game', {
        igdbType: 'Expansion',
        parentTitle: 'The Witcher 3: Wild Hunt',
      }),
    ).toEqual({
      role: 'expansion',
      editionTitle: null,
      parentTitle: 'The Witcher 3: Wild Hunt',
    });
  });

  it('prefers the explicit edition name', () => {
    expect(
      gameSearchContext('game', {
        igdbType: 'Bundle',
        editionTitle: 'Game of the Year Edition',
        parentTitle: 'The Witcher 3: Wild Hunt',
      }),
    ).toMatchObject({ role: 'edition', editionTitle: 'Game of the Year Edition' });
  });

  it('does not add game context to other kinds or base games', () => {
    expect(gameSearchContext('anime', { igdbType: 'Expansion' })).toBeNull();
    expect(gameSearchContext('game', { igdbType: 'Main Game' })).toMatchObject({ role: null });
  });

  it('groups related releases under the parent game without dropping them', () => {
    const base = hit('base', 'The Witcher 3: Wild Hunt');
    const expansion = hit('dlc', 'Blood and Wine', {
      igdbType: 'Expansion',
      parentTitle: base.title,
    });
    const anime = hit('anime', 'The Witcher', {}, 'anime');

    expect(groupGameSearchResults([expansion, anime, base])).toEqual([
      { result: base, related: [expansion] },
      { result: anime, related: [] },
    ]);
  });
});
