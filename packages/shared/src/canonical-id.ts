import type { MediaKind } from './media.js';

/**
 * Trackt catalog namespace for RFC 4122 UUIDv5 derivation
 * (= uuidv5(DNS namespace, 'catalog.trackt.app')).
 * Canonical media IDs are derived from it, so it must NEVER change (ADR-0001).
 */
export const TRACKT_CATALOG_NAMESPACE = 'f8d11238-d681-551c-875d-5ac53892f6e7';

/**
 * Identity is derived from the work's own attributes — kind, title, year — and is
 * deliberately NOT tied to any upstream provider's numbering (ADR-0005, superseding
 * ADR-0001 point 2). `external_ids` survives as enrichment/cross-reference data, but
 * nothing about a work's identity depends on TMDB or AniList existing.
 *
 * The trade this makes: a provider ID is a guaranteed-unique handle, whereas
 * kind+title+year is not. Two distinct works CAN share all three (remakes, generic
 * titles, anthologies), so the key carries an explicit `discriminator` for the second
 * and later claimants, and the catalog resolves genuine duplicates through the alias
 * table rather than by re-minting IDs.
 */

/** Fields of a work that together determine its canonical identity. */
export interface CanonicalMediaIdentity {
  kind: MediaKind;
  title: string;
  /** Release/publication year; null only when genuinely unknown. */
  year: number | null;
  /** Which season this row is, for per-season series/anime rows (ADR-0003). */
  seasonNumber?: number | null;
  /**
   * Set ONLY to break a collision with an already-published work of the same
   * kind+title+year(+season). Absent for the first claimant, so the common case
   * stays clean. Stored on the row: without it the key is not reproducible.
   */
  discriminator?: string | null;
}

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

/**
 * Fold a title to its identity form. FROZEN FOREVER: this function's output feeds
 * every canonical ID, so any change to it silently re-identifies the entire catalog.
 *
 * Deliberately NOT `mediaSlug` — that one strips every non-latin character, so
 * 葬送のフリーレン and 鬼滅の刃 both reduce to the same stem. Fine for a URL, fatal
 * for identity. Here we keep all Unicode letters and digits and only fold away the
 * things that are pure typography:
 *
 * - NFKC, so full-width and ligature forms match their plain equivalents
 * - case, via locale-independent `toLowerCase` (never `toLocaleLowerCase` — a
 *   Turkish locale would fold 'I' to 'ı' and mint different IDs on different hosts)
 * - apostrophes, so `Howl's` and `Howls` agree
 * - every other punctuation/symbol run collapses to a single space
 */
export function normalizeCanonicalTitle(title: string): string {
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/['’‘`´]/gu, '')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!normalized) {
    throw new Error(`Title '${title}' normalizes to nothing — it cannot identify a work.`);
  }
  return normalized;
}

/**
 * Canonical key for a work, e.g. `movie:the matrix:1999` or
 * `series:breaking bad:2008:s2`. Frozen forever.
 *
 * `year` is part of the key rather than optional-and-ignored: dropping it for
 * unknown-year works would make every untitled-year work of the same name collide,
 * so a null year is spelled explicitly as an empty segment and stays distinct from
 * any real year.
 */
export function canonicalMediaKey(identity: CanonicalMediaIdentity): string {
  const { kind, title, year, seasonNumber, discriminator } = identity;
  let key = `${kind}:${normalizeCanonicalTitle(title)}:${year ?? ''}`;
  if (seasonNumber != null) key += `:s${seasonNumber}`;
  if (discriminator) key += `:#${normalizeCanonicalTitle(discriminator)}`;
  return key;
}

/**
 * Deterministic canonical media ID: every instance derives the same UUID for the
 * same work with no coordination, which is what keeps catalogs interchangeable
 * across instances (ADR-0001 point 2, as amended by ADR-0005).
 *
 * This is a SEED, not a live function of the row. Derive it once when a work is
 * first published, store it, and never re-derive: correcting a title typo must not
 * re-mint the ID and orphan every user's tracking history. Renames are a display
 * concern; identity is settled at first publish.
 */
export function canonicalMediaId(identity: CanonicalMediaIdentity): string {
  return uuidv5(TRACKT_CATALOG_NAMESPACE, canonicalMediaKey(identity));
}

/**
 * Canonical ID for a single TV season, which is its own `series` media (ADR-0003).
 * The show title is shared across seasons by design (ADR-0003 point 4), so the
 * season number is what separates them: `series:breaking bad:2008:s2`.
 *
 * `year` is the ROW's own year — for a season row that is the season's air year
 * (Breaking Bad S1 = 2008, S2 = 2009), not the show's. Using the show year would
 * be marginally more stable, but the row doesn't store it, and the publish guard
 * has to reproduce the key from the row alone. Deriving identity from a field the
 * row doesn't carry is how a guard silently stops guarding.
 */
export function canonicalSeriesSeasonId(
  title: string,
  year: number | null,
  seasonNumber: number,
  discriminator?: string | null,
): string {
  return canonicalMediaId({ kind: 'series', title, year, seasonNumber, discriminator });
}
