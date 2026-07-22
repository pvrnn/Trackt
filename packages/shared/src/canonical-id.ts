import type { MediaKind } from './media.js';

/**
 * Trackt catalog namespace for RFC 4122 UUIDv5 derivation
 * (= uuidv5(DNS namespace, 'catalog.trackt.app')).
 * Canonical media IDs are derived from it, so it must NEVER change (ADR-0001).
 */
export const TRACKT_CATALOG_NAMESPACE = 'f8d11238-d681-551c-875d-5ac53892f6e7';

/**
 * The single provider whose external ID defines a work's canonical identity, per kind.
 * Webtoons have no upstream identity provider: entries are user-created and keep
 * random UUIDs (ADR-0001).
 */
export const IDENTITY_PROVIDER_BY_KIND: Record<MediaKind, string | null> = {
  movie: 'tmdb',
  series: 'tmdb',
  anime: 'anilist',
  manga: 'anilist',
  webtoon: null,
};

/**
 * Pure-TS SHA-1 (RFC 3174). This package is the shared contract for servers AND
 * the browser bundle, so it can't touch node:crypto; Web Crypto's digest is
 * async and would poison the uuidv5 API. Inputs here are tiny (a UUID + short
 * key), so performance is irrelevant. Correctness is pinned by the RFC 4122
 * reference vectors in canonical-id.test.ts.
 */
function sha1(message: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (n << 1) | (n >>> 31);
    }
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const next = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      [a, b, c, d, e] = [next, a, (b << 30) | (b >>> 2), c, d];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  [h0, h1, h2, h3, h4].forEach((word, index) => digestView.setUint32(index * 4, word));
  return digest;
}

/** RFC 4122 UUIDv5 (SHA-1, name-based). */
export function uuidv5(namespace: string, name: string): string {
  const nsHex = namespace.replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/.test(nsHex)) throw new Error(`Invalid UUID namespace: ${namespace}`);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  for (let i = 0; i < 16; i++) input[i] = parseInt(nsHex.slice(i * 2, i * 2 + 2), 16);
  input.set(nameBytes, 16);

  const bytes = sha1(input).subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Canonical key for a work, e.g. 'tmdb:movie:603'. */
export function canonicalMediaKey(
  provider: string,
  kind: MediaKind,
  externalId: string | number,
): string {
  return `${provider}:${kind}:${externalId}`;
}

/**
 * Deterministic canonical media ID: every instance derives the same UUID for the
 * same work with no coordination, which is what keeps catalogs interchangeable
 * across instances (ADR-0001). `provider` defaults to the kind's identity provider.
 */
export function canonicalMediaId(
  kind: MediaKind,
  externalId: string | number,
  provider: string = IDENTITY_PROVIDER_BY_KIND[kind] ?? '',
): string {
  if (!provider) {
    throw new Error(
      `Media kind '${kind}' has no identity provider — user-created entries keep random UUIDs.`,
    );
  }
  return uuidv5(TRACKT_CATALOG_NAMESPACE, canonicalMediaKey(provider, kind, externalId));
}

/**
 * Canonical ID for a single TV season, which is its own `series` media (ADR-0003):
 * the composite external key is `<showTmdbId>:<seasonNumber>`, giving
 * `tmdb:series:1396:1`. Frozen forever like every canonical key. Anime seasons
 * need no equivalent — AniList already issues a distinct id per season/cour, so
 * they go through `canonicalMediaId('anime', anilistId)` directly.
 */
export function canonicalSeriesSeasonId(showTmdbId: string | number, seasonNumber: number): string {
  return canonicalMediaId('series', `${showTmdbId}:${seasonNumber}`);
}
