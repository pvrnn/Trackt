import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isStrictCompatible, toJsonSchema } from '../src/json-schema.js';

const strict = (schema: z.ZodType) => isStrictCompatible(toJsonSchema(schema, 'S'));

describe('toJsonSchema', () => {
  it('drops the document-level $schema key', () => {
    expect(toJsonSchema(z.object({ a: z.string() }), 'S')).not.toHaveProperty('$schema');
  });
});

describe('isStrictCompatible', () => {
  it('accepts objects whose properties are all required, nested included', () => {
    expect(
      strict(
        z.object({
          a: z.string(),
          b: z.string().nullable(),
          c: z.array(z.object({ d: z.number() })),
        }),
      ),
    ).toBe(true);
  });

  it('rejects an optional property at any depth', () => {
    expect(strict(z.object({ a: z.string().optional() }))).toBe(false);
    expect(strict(z.object({ a: z.array(z.object({ b: z.string().optional() })) }))).toBe(false);
  });

  it('rejects an object open to additional properties', () => {
    expect(strict(z.object({ a: z.record(z.string(), z.string()) }))).toBe(false);
    expect(strict(z.looseObject({ a: z.string() }))).toBe(false);
  });
});
