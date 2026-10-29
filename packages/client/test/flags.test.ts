import { describe, expect, it } from 'vitest';
import { flagValue, flagsKey } from '../src/flags.js';

describe('flagValue', () => {
  it('falls back to the compiled default before the snapshot resolves', () => {
    expect(flagValue(undefined, 'lists.custom')).toBe(true);
  });

  it('uses the snapshot when it has the key', () => {
    expect(flagValue({ flags: { 'lists.custom': false } }, 'lists.custom')).toBe(false);
    expect(flagValue({ flags: { 'lists.custom': true } }, 'lists.custom')).toBe(true);
  });

  it('falls back to the default for a key the snapshot omits', () => {
    // An old binary asking a newer instance, or the reverse: absence means
    // "this build and this server do not agree on the key", never "off".
    expect(flagValue({ flags: {} }, 'lists.custom')).toBe(true);
    expect(flagValue({ flags: { 'other.feature': false } }, 'lists.custom')).toBe(true);
  });
});

describe('flagsKey', () => {
  it('names the anonymous viewer explicitly', () => {
    expect(flagsKey(null)).toEqual(['flags', 'anonymous']);
  });

  it('separates the signed-in cache entry from the anonymous one', () => {
    expect(flagsKey('user-1')).toEqual(['flags', 'user-1']);
    expect(flagsKey('user-1')).not.toEqual(flagsKey(null));
    expect(flagsKey('user-1')).not.toEqual(flagsKey('user-2'));
  });
});
