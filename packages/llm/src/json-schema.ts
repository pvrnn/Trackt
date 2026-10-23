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
