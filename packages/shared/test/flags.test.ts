import { describe, expect, it } from 'vitest';
import { FLAG_DEFINITIONS, parseFlagOverrides } from '../src/flags.js';

describe('parseFlagOverrides', () => {
  it('treats an unset or empty string as no overrides', () => {
    expect(parseFlagOverrides(undefined)).toEqual({ overrides: {}, warnings: [] });
    expect(parseFlagOverrides('')).toEqual({ overrides: {}, warnings: [] });
    expect(parseFlagOverrides('   ')).toEqual({ overrides: {}, warnings: [] });
  });

  it('reads on, off and a whole percent', () => {
    expect(parseFlagOverrides('lists.custom=on').overrides).toEqual({ 'lists.custom': true });
    expect(parseFlagOverrides('lists.custom=off').overrides).toEqual({ 'lists.custom': false });
    expect(parseFlagOverrides('lists.custom=0').overrides).toEqual({ 'lists.custom': 0 });
    expect(parseFlagOverrides('lists.custom=25').overrides).toEqual({ 'lists.custom': 25 });
    expect(parseFlagOverrides('lists.custom=100').overrides).toEqual({ 'lists.custom': 100 });
  });

  it('ignores whitespace around entries and values', () => {
    expect(parseFlagOverrides('  lists.custom = off  ').overrides).toEqual({
      'lists.custom': false,
    });
  });

  it('warns about an unknown key and keeps reading', () => {
    const parsed = parseFlagOverrides('nope.old=off');
    expect(parsed.overrides).toEqual({});
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('nope.old');
  });

  it('warns about a value outside the grammar', () => {
    for (const value of ['maybe', '101', '-1', '12.5', '']) {
      const parsed = parseFlagOverrides(`lists.custom=${value}`);
      expect(parsed.overrides).toEqual({});
      expect(parsed.warnings).toHaveLength(1);
    }
  });

  it('warns about a missing = but still names the entry', () => {
    const parsed = parseFlagOverrides('lists.custom');
    expect(parsed.overrides).toEqual({});
    expect(parsed.warnings[0]).toContain('lists.custom');
  });

  it('lets the last duplicate win, with a warning', () => {
    const parsed = parseFlagOverrides('lists.custom=off,lists.custom=25');
    expect(parsed.overrides).toEqual({ 'lists.custom': 25 });
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('twice');
  });

  it('warns about an empty entry rather than inventing one', () => {
    const parsed = parseFlagOverrides('lists.custom=off,');
    expect(parsed.overrides).toEqual({ 'lists.custom': false });
    expect(parsed.warnings).toHaveLength(1);
  });
});

describe('the registry', () => {
  it('gives every flag an owner, a review date and a shipped default', () => {
    for (const [key, definition] of Object.entries(FLAG_DEFINITIONS)) {
      expect(key).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(definition.owner).not.toBe('');
      expect(definition.removeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof definition.default).toBe('boolean');
    }
  });
});
