import { describe, expect, it } from 'vitest';
import {
  CreateMediaBodySchema,
  ModerationPatchBodySchema,
  ModerationQueueQuerySchema,
  isModerator,
} from '../src/media-entry.js';

describe('isModerator', () => {
  it('grants moderator and admin, not user', () => {
    expect(isModerator('user')).toBe(false);
    expect(isModerator('moderator')).toBe(true);
    expect(isModerator('admin')).toBe(true);
  });
});

describe('CreateMediaBodySchema', () => {
  const base = { kind: 'webtoon', title: 'Tower of God' } as const;

  it('accepts a minimal body', () => {
    expect(CreateMediaBodySchema.parse(base)).toMatchObject(base);
  });

  it('trims the title and rejects blank ones', () => {
    expect(CreateMediaBodySchema.parse({ ...base, title: '  Tower of God  ' }).title).toBe(
      'Tower of God',
    );
    expect(CreateMediaBodySchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });

  it.each([
    // partCount applies to every kind except movie; seasonNumber only to series/anime (ADR-0003).
    ['movie', {}, true],
    ['movie', { partCount: 12 }, false],
    ['movie', { seasonNumber: 1 }, false],
    ['series', { partCount: 12, seasonNumber: 2 }, true],
    ['series', { seasonNumber: 2 }, true],
    ['anime', { partCount: 24, seasonNumber: 1 }, true],
    ['manga', { partCount: 120 }, true],
    ['manga', { seasonNumber: 1 }, false],
    ['webtoon', { partCount: 550 }, true],
    ['webtoon', { seasonNumber: 1 }, false],
  ] as const)('%s with %o → valid=%s', (kind, fields, valid) => {
    const result = CreateMediaBodySchema.safeParse({ ...base, kind, ...fields });
    expect(result.success).toBe(valid);
  });

  it('ignores explicit nulls for non-applicable fields', () => {
    const result = CreateMediaBodySchema.safeParse({ ...base, kind: 'movie', partCount: null });
    expect(result.success).toBe(true);
  });

  it('bounds the year', () => {
    expect(CreateMediaBodySchema.safeParse({ ...base, year: 1849 }).success).toBe(false);
    expect(CreateMediaBodySchema.safeParse({ ...base, year: 2020 }).success).toBe(true);
    const tooFar = new Date().getFullYear() + 6;
    expect(CreateMediaBodySchema.safeParse({ ...base, year: tooFar }).success).toBe(false);
  });

  it('caps genre/synonym lists at 12', () => {
    const genres = Array.from({ length: 13 }, (_, i) => `genre-${i}`);
    expect(CreateMediaBodySchema.safeParse({ ...base, genres }).success).toBe(false);
  });
});

describe('ModerationPatchBodySchema', () => {
  it('rejects an empty patch', () => {
    expect(ModerationPatchBodySchema.safeParse({}).success).toBe(false);
  });

  it('accepts a verdict alone, in both directions', () => {
    expect(ModerationPatchBodySchema.safeParse({ moderation: 'verified' }).success).toBe(true);
    expect(ModerationPatchBodySchema.safeParse({ moderation: 'rejected' }).success).toBe(true);
  });

  it('never accepts a transition back to unverified', () => {
    expect(ModerationPatchBodySchema.safeParse({ moderation: 'unverified' }).success).toBe(false);
  });

  it('accepts field edits without a verdict', () => {
    expect(ModerationPatchBodySchema.safeParse({ title: 'Fixed Title', year: 2019 }).success).toBe(
      true,
    );
  });
});

describe('ModerationQueueQuerySchema', () => {
  it('defaults to unverified and rejects other statuses', () => {
    expect(ModerationQueueQuerySchema.parse({}).status).toBe('unverified');
    expect(ModerationQueueQuerySchema.safeParse({ status: 'verified' }).success).toBe(false);
  });
});
