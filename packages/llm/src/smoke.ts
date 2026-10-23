import { z } from 'zod';
import { loadLlmEnv } from './env.js';
import { OpenAiCompatibleClient } from './openai-compatible.js';

/**
 * `pnpm --filter @trackt/llm smoke` — the fastest way to validate a provider
 * config by hand: one `completeJson` round trip, printed with token usage.
 */

const SmokeSchema = z.object({
  greeting: z.string(),
  wordCount: z.number().int().nonnegative(),
});

async function main(): Promise<void> {
  const env = loadLlmEnv();
  const client = new OpenAiCompatibleClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: env.model,
    maxOutputTokens: env.maxOutputTokens,
    timeoutMs: env.timeoutMs,
    jsonMode: env.jsonMode,
    extraBody: env.extraBody,
  });

  console.log(`[smoke] ${env.model} @ ${env.baseUrl} (jsonMode: ${env.jsonMode})`);

  const result = await client.completeJson({
    system: 'You reply only with JSON matching the given schema.',
    user: 'Greet Trackt in one short sentence and report how many words are in it.',
    schema: SmokeSchema,
    schemaName: 'Smoke',
  });

  console.log('[smoke] value:', result.value);
  console.log('[smoke] model:', result.model);
  console.log('[smoke] usage:', result.usage);
}

main().catch((error: unknown) => {
  console.error('[smoke] failed:', error);
  process.exitCode = 1;
});
