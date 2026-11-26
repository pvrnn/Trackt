import { z } from 'zod';

/**
 * One call site for deriving a JSON Schema from a Zod type — shared by the
 * `json_schema`/`json_object` negotiation steps here and, later, by
 * `apps/newsroom`'s `export-schemas` script (news-and-newsroom-plan.md Phase 6),
 * so the optimizer never drifts from what the runtime actually accepts.
 *
 * Zod 4 ships its own JSON Schema conversion (`z.toJSONSchema`) — no
 * `zod-to-json-schema` dependency needed, and no v3/v4 type-compat gap (that
 * package's published types still import from `zod/v3`). `$schema` is a
 * document-level meta key that has no place inside a provider's
 * `response_format.json_schema.schema`, so it's stripped.
 */
export function toJsonSchema<T>(schema: z.ZodType<T>, _name: string): Record<string, unknown> {
  const { $schema: _$schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown> & {
    $schema?: string;
  };
  return rest;
}

/**
 * Whether `strict: true` structured output can accept this schema: strict mode rejects any
 * object with an optional property or open `additionalProperties`, and that 400 would push
 * `auto` down the ladder for every later call, not just this schema's.
 */
export function isStrictCompatible(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(isStrictCompatible);
  if (node === null || typeof node !== 'object') return true;
  const schema = node as Record<string, unknown>;
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) return false;
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    if (Object.keys(properties).some((key) => !required.includes(key))) return false;
  }
  return Object.values(schema).every(isStrictCompatible);
}
