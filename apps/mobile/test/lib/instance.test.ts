import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@trackt/shared';
import {
  compareVersions,
  describeProbeFailure,
  normalizeOrigin,
  probeInstance,
  resolveInstanceUrl,
  safeRoute,
  setActiveInstance,
} from '../../src/lib/instance';

describe('normalizeOrigin', () => {
  it('assumes https for a bare host', () => {
    expect(normalizeOrigin('trackt.example.com')).toBe('https://trackt.example.com');
  });

  it('keeps an explicit http scheme and port for LAN instances', () => {
    expect(normalizeOrigin('http://192.168.1.10:3000')).toBe('http://192.168.1.10:3000');
  });

  it('drops everything past the authority', () => {
    expect(normalizeOrigin('https://trackt.example.com/home?x=1#y')).toBe(
      'https://trackt.example.com',
    );
  });

  it('trims surrounding whitespace, which pasting always brings', () => {
    expect(normalizeOrigin('  trackt.example.com  ')).toBe('https://trackt.example.com');
  });

  it('rejects a non-http scheme', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
  });

  it('rejects backslashes, which parsers normalise to slashes', () => {
    expect(normalizeOrigin('https:/\\evil.example')).toBeNull();
  });

  it('rejects embedded credentials rather than silently storing them', () => {
    expect(normalizeOrigin('https://user:pw@trackt.example.com')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizeOrigin('   ')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by segment, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('treats an unparseable segment as zero rather than throwing', () => {
    expect(compareVersions('nightly', '0.0.0')).toBe(0);
  });
});

describe('probeInstance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<unknown>) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('accepts a healthy instance and reports its version', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', version: APP_VERSION }),
    }));
    await expect(probeInstance('https://trackt.example.com')).resolves.toEqual({
      ok: true,
      origin: 'https://trackt.example.com',
      version: APP_VERSION,
    });
  });

  it('reports unreachable when nothing answers', async () => {
    stubFetch(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(probeInstance('https://nope.example')).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('reports not-trackt when something answers with the wrong body', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ hello: 'world' }) }));
    await expect(probeInstance('https://router.local')).resolves.toEqual({
      ok: false,
      reason: 'not-trackt',
    });
  });

  it('reports not-trackt on a non-2xx, not unreachable', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    await expect(probeInstance('https://proxy.example')).resolves.toEqual({
      ok: false,
      reason: 'not-trackt',
    });
  });

  it('reports too-old, carrying the version so the message can name it', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.0.1' }),
    }));
    const result = await probeInstance('https://old.example');
    expect(result).toEqual({ ok: false, reason: 'too-old', version: '0.0.1' });
    if (!result.ok) expect(describeProbeFailure(result)).toContain('0.0.1');
  });

  it('probes /healthz on the given origin', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', version: APP_VERSION }),
    }));
    await probeInstance('http://192.168.1.10:3000');
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:3000/healthz',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });
});

describe('resolveInstanceUrl', () => {
  afterEach(() => setActiveInstance(null));

  it('absolutizes an instance-relative upload path', () => {
    setActiveInstance('https://trackt.example.com');
    expect(resolveInstanceUrl('/uploads/covers/a.jpg')).toBe(
      'https://trackt.example.com/uploads/covers/a.jpg',
    );
  });

  it('passes an absolute provider URL through untouched', () => {
    setActiveInstance('https://trackt.example.com');
    expect(resolveInstanceUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });

  it('returns null rather than a plausible wrong URL for a protocol-relative path', () => {
    setActiveInstance('https://trackt.example.com');
    expect(resolveInstanceUrl('//evil.example/x.jpg')).toBeNull();
  });

  it('returns null for a relative path, which has no defined base here', () => {
    setActiveInstance('https://trackt.example.com');
    expect(resolveInstanceUrl('uploads/x.jpg')).toBeNull();
  });

  it('returns null when no instance is active', () => {
    expect(resolveInstanceUrl('/uploads/x.jpg')).toBeNull();
  });

  it('returns null for empty input, so callers can pass an optional field', () => {
    expect(resolveInstanceUrl(null)).toBeNull();
    expect(resolveInstanceUrl(undefined)).toBeNull();
    expect(resolveInstanceUrl('')).toBeNull();
  });
});

describe('safeRoute', () => {
  it('accepts an in-app path', () => {
    expect(safeRoute('/media/dune')).toBe('/media/dune');
  });

  it('rejects anything that could leave the app', () => {
    expect(safeRoute('//evil.example')).toBeUndefined();
    expect(safeRoute('https://evil.example')).toBeUndefined();
    expect(safeRoute('/\\evil.example')).toBeUndefined();
    expect(safeRoute(42)).toBeUndefined();
  });
});
