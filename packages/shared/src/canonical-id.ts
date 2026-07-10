import { createHash } from 'node:crypto';
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

/** RFC 4122 UUIDv5 (SHA-1, name-based). */
export function uuidv5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (ns.length !== 16) throw new Error(`Invalid UUID namespace: ${namespace}`);
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
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
