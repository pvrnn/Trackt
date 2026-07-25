import { describe, expect, it } from 'vitest';
import {
  MEDIA_RELATION_LABELS,
  MEDIA_RELATION_TYPES,
  MediaRelationLabelSchema,
  MediaRelationTypeSchema,
  REVERSE_RELATION_LABEL,
  relationLabel,
} from '../src/index.js';

/**
 * The relation vocabularies (ADR-0004). Stored types constrain database columns;
 * labels constrain a response field. The superset relationship between them is
 * compile-time-enforced by `relationLabel`, but the reverse map's *content* is
 * not — a wrong entry here would silently mislabel every reverse edge.
 */
describe('relation vocabularies', () => {
  it('labels a forward edge with its stored type unchanged', () => {
    for (const type of MEDIA_RELATION_TYPES) {
      expect(relationLabel(type, 'forward')).toBe(type);
    }
  });

  it('has a reverse label for every stored type', () => {
    for (const type of MEDIA_RELATION_TYPES) {
      expect(REVERSE_RELATION_LABEL[type]).toBeDefined();
    }
    expect(Object.keys(REVERSE_RELATION_LABEL).sort()).toEqual([...MEDIA_RELATION_TYPES].sort());
  });

  it('reverses each type to its expected reading', () => {
    expect(relationLabel('sequel', 'reverse')).toBe('prequel');
    expect(relationLabel('adaptation', 'reverse')).toBe('source');
    expect(relationLabel('spinoff', 'reverse')).toBe('parent');
  });

  it('treats `related` as its own inverse', () => {
    expect(relationLabel('related', 'forward')).toBe('related');
    expect(relationLabel('related', 'reverse')).toBe('related');
  });

  it('only ever produces a valid label', () => {
    for (const type of MEDIA_RELATION_TYPES) {
      for (const direction of ['forward', 'reverse'] as const) {
        expect(MediaRelationLabelSchema.safeParse(relationLabel(type, direction)).success).toBe(
          true,
        );
      }
    }
  });

  it('keeps every stored type a valid label, but not vice versa', () => {
    for (const type of MEDIA_RELATION_TYPES) {
      expect(MEDIA_RELATION_LABELS).toContain(type);
    }
    // The reverse-only readings must never be storable — that's the whole point
    // of keeping two enums instead of one.
    for (const reverseOnly of ['prequel', 'source', 'parent'] as const) {
      expect(MediaRelationTypeSchema.safeParse(reverseOnly).success).toBe(false);
    }
  });
});
