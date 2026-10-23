import { z } from 'zod';

/**
 * Config for `src/smoke.ts` only — no deployed consumer exists yet (that's
 * `apps/newsroom`, news-and-newsroom-plan.md Phase 4). Dev defaults point at a
 * local Ollama so the smoke script runs with zero configuration. When Phase 4
 * lands, this generalizes into `packages/shared` alongside `env-catalog.ts`
 * rather than being duplicated.
 */

const RawLlmEnvSchema = z.object({
  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('llama3.2'),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LLM_JSON_MODE: z.enum(['auto', 'json_schema', 'json_object', 'prompt']).default('auto'),
  LLM_EXTRA_BODY: z.string().default('{}'),
});

export interface LlmEnv {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  jsonMode: 'auto' | 'json_schema' | 'json_object' | 'prompt';
  extraBody: Record<string, unknown>;
}

export class LlmEnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmEnvValidationError';
  }
}

export function loadLlmEnv(source: Record<string, string | undefined> = process.env): LlmEnv {
  const parsed = RawLlmEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new LlmEnvValidationError(`Invalid LLM environment configuration:\n${lines.join('\n')}`);
  }

  let extraBody: Record<string, unknown>;
  try {
    extraBody = JSON.parse(parsed.data.LLM_EXTRA_BODY) as Record<string, unknown>;
  } catch {
    throw new LlmEnvValidationError('LLM_EXTRA_BODY must be a valid JSON object string');
  }

  return {
    baseUrl: parsed.data.LLM_BASE_URL,
    apiKey: parsed.data.LLM_API_KEY || undefined,
    model: parsed.data.LLM_MODEL,
    maxOutputTokens: parsed.data.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: parsed.data.LLM_TIMEOUT_MS,
    jsonMode: parsed.data.LLM_JSON_MODE,
    extraBody,
  };
}
