import { describe, expect, it } from 'vitest';
import { safeHref, safeRedirect } from '../../src/lib/url';

describe('safeRedirect', () => {
  it('keeps same-app paths', () => {
    expect(safeRedirect('/home')).toBe('/home');
    expect(safeRedirect('/media/attack-on-titan')).toBe('/media/attack-on-titan');
    expect(safeRedirect('/search?q=neon&kind=anime')).toBe('/search?q=neon&kind=anime');
  });

  it('rejects other origins', () => {
    expect(safeRedirect('https://evil.com')).toBeUndefined();
    expect(safeRedirect('//evil.com')).toBeUndefined();
    expect(safeRedirect('http://localhost:3000/home')).toBeUndefined();
  });

  it('rejects backslash paths that browsers normalise into protocol-relative URLs', () => {
    // `/\evil.com` starts with '/' and not '//', so a naive check admits it —
    // then the browser reads the backslash as a slash and leaves the origin.
    expect(safeRedirect('/\\evil.com')).toBeUndefined();
    expect(safeRedirect('/\\/evil.com')).toBeUndefined();
    expect(safeRedirect('/home\\..\\evil.com')).toBeUndefined();
  });

  it('rejects anything that is not a string or not rooted', () => {
    expect(safeRedirect(undefined)).toBeUndefined();
    expect(safeRedirect(42)).toBeUndefined();
    expect(safeRedirect('home')).toBeUndefined();
    expect(safeRedirect('')).toBeUndefined();
  });
});

describe('safeHref', () => {
  it('passes http(s) links through, normalised', () => {
    expect(safeHref('https://example.com/story')).toBe('https://example.com/story');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
  });

  it('leaves relative links relative', () => {
    // Resolving these against the probe base would rewrite every in-article
    // link to example.invalid.
    expect(safeHref('/news/season-two')).toBe('/news/season-two');
    expect(safeHref('season-two')).toBe('season-two');
  });

  it('normalises protocol-relative links so they cannot pose as site-relative', () => {
    expect(safeHref('//evil.com/x')).toBe('https://evil.com/x');
  });

  it('refuses script and data schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });
});
