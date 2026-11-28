import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import { netflixUploadLabel, parseCsv, readNetflixUpload } from '../src/netflix/upload.js';
import { readImportUpload } from '../src/upload.js';

/** `NetflixViewingHistory.csv` as a French-language US-dated profile writes it, newest first. */
const HISTORY = [
  '﻿Title,Date',
  '"Better Call Saul: Saison 2: Cobbler","11/26/26"',
  '"Better Call Saul: Saison 2: Switch","11/25/26"',
  '"Better Call Saul: Saison 1: Uno","11/13/26"',
  '"Better Call Saul: Saison 1: Uno","11/12/26"',
  '"Suits : avocats sur mesure: Saison 1 : Pilote","10/31/26"',
  '"Le jeu de la dame: Mini-série: Ouvertures","10/30/26"',
  '"Beastars: Dernière saison: Épisode 1","10/29/26"',
  '"Frieren: Le privilège de la jeunesse","10/28/26"',
  '"Frieren: Un authentique héros","10/27/26"',
  '"Pluto: Épisode 1","10/26/26"',
  '"Cyberpunk: Edgerunners: Let You Down","10/20/26"',
  '"Cyberpunk: Edgerunners: Cyberpunk: Edgerunners 2: Serce","10/20/26"',
  '"Cyberpunk: Edgerunners: Cyberpunk: Edgerunners 2: Last Chance","10/21/26"',
  '"Mad Max: Fury Road","10/7/19"',
  '"Nymphomaniac: Part 1","11/6/19"',
  '"Oppenheimer","12/22/24"',
  '"Oppenheimer","12/21/24"',
  '" : Épisode 3","8/24/19"',
  '" ","8/24/19"',
].join('\r\n');

const read = (content: string, name = 'NetflixViewingHistory.csv') =>
  readNetflixUpload([{ name, content }]);

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes and both line endings', () => {
    expect(parseCsv('Title,Date\r\n"A, ""B""",1/2/26\nC,3/4/26\n')).toEqual([
      ['Title', 'Date'],
      ['A, "B"', '1/2/26'],
      ['C', '3/4/26'],
    ]);
  });
});

describe('readNetflixUpload', () => {
  const upload = read(HISTORY);
  const season = (show: string, number = 1) =>
    upload.seasons.find((row) => row.show === show && row.number === number);

  it('groups marked episodes into numbered seasons, counting each episode once', () => {
    expect(season('Better Call Saul', 1)).toEqual({
      show: 'Better Call Saul',
      number: 1,
      episodes: 1,
      firstWatchedAt: '2026-11-12',
      lastWatchedAt: '2026-11-13',
      assumed: false,
    });
    expect(season('Better Call Saul', 2)).toMatchObject({ episodes: 2, assumed: false });
  });

  it('keeps a title’s own colon in the show and reads a limited series as season 1', () => {
    expect(season('Suits : avocats sur mesure')).toMatchObject({ episodes: 1, assumed: false });
    expect(season('Le jeu de la dame')).toMatchObject({ episodes: 1, assumed: false });
  });

  it('places unmarked episodes in season 1 when another row or an episode number says so', () => {
    expect(season('Frieren')).toMatchObject({ episodes: 2, assumed: true });
    expect(season('Pluto')).toMatchObject({ episodes: 1, assumed: true });
    expect(season('Cyberpunk: Edgerunners')).toMatchObject({ episodes: 1 });
    // A sequel nested under the original's page is its own show.
    expect(season('Cyberpunk: Edgerunners 2')).toMatchObject({ episodes: 2 });
  });

  it('reads a lone subtitled title as a film, with the days it was watched', () => {
    expect(upload.movies.map((movie) => movie.title).sort()).toEqual([
      'Mad Max: Fury Road',
      'Nymphomaniac: Part 1',
      'Oppenheimer',
    ]);
    expect(upload.movies.find((movie) => movie.title === 'Oppenheimer')).toEqual({
      title: 'Oppenheimer',
      firstWatchedAt: '2024-12-21',
      lastWatchedAt: '2024-12-22',
    });
  });

  it('keeps an unnumbered season aside and counts rows with no show', () => {
    expect(upload.unplaced).toEqual([{ show: 'Beastars', label: 'Dernière saison', episodes: 1 }]);
    expect(upload.skipped).toBe(2);
  });

  it('reads day-first and ISO dates', () => {
    const dayFirst = read('Title,Date\n"Drive","26/11/2026"\n"Taken","3/4/2026"\n');
    expect(dayFirst.movies.map((movie) => movie.firstWatchedAt)).toEqual([
      '2026-11-26',
      '2026-04-03',
    ]);
    expect(read('Title,Date\nDrive,2026-11-26\n').movies[0]?.firstWatchedAt).toBe('2026-11-26');
  });

  it('names the run after the history’s last day', () => {
    expect(netflixUploadLabel(upload)).toBe('history to 2026-11-26');
  });

  it('refuses a file that is not the history', () => {
    expect(() => read('{"movies": []}', 'export.json')).toThrow(ImportError);
    expect(() => read('Title,Date,Extra\nA,1/1/26,x\n')).toThrow(/two columns/);
    expect(() => read('Title,Date\nA,yesterday\n')).toThrow(/no row has a date/);
    expect(() => readNetflixUpload([])).toThrow(/NetflixViewingHistory\.csv/);
  });

  it('is the reader the API calls for the netflix source', () => {
    const result = readImportUpload('netflix', [
      { name: 'NetflixViewingHistory.csv', content: HISTORY },
    ]);
    expect(result.profile).toBe('history to 2026-11-26');
    expect(result.upload).toEqual(upload);
  });
});
