import { describe, expect, it } from 'vitest';
import { discoverFilterParams, hasDiscoverFilters } from '../src/search.js';

describe('discoverFilterParams', () => {
  it('adds nothing to the key or the request when the panel narrows nothing', () => {
    expect(discoverFilterParams()).toEqual({ key: [], params: {} });
    expect(discoverFilterParams({ genres: [], status: undefined })).toEqual({
      key: [],
      params: {},
    });
    expect(hasDiscoverFilters({ genres: [] })).toBe(false);
  });

  it('keys the same genres the same way whatever order they were picked in', () => {
    const a = discoverFilterParams({ genres: ['drama', 'action'], status: 'ongoing' });
    const b = discoverFilterParams({ genres: ['action', 'drama'], status: 'ongoing' });
    expect(a).toEqual(b);
    expect(a.params).toEqual({ genres: 'action,drama', status: 'ongoing' });
    expect(hasDiscoverFilters({ status: 'ended' })).toBe(true);
  });
});
