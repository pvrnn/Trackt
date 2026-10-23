import type { z } from 'zod';

/**
 * Provider-agnostic LLM port (news-and-newsroom-plan.md Phase 0). Deliberately
 * narrow — text in, text or JSON out — so a new provider means implementing two
 * methods, never a code change on the calling side.
 */
export interface LlmClient {
  /** Free-text completion. */
  complete(req: LlmRequest): Promise<LlmResult<string>>;
  /** Schema-constrained completion: returns a value already parsed by `schema`. */
  completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmResult<T>>;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxOutputTokens?: number;
  /** Merged into the request body verbatim — provider-specific knobs, no code change. */
  extraBody?: Record<string, unknown>;
}

export interface LlmJsonRequest<T> extends LlmRequest {
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface LlmResult<T> {
  value: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

/** How `completeJson` asks the provider for structured output. */
export type LlmJsonMode = 'auto' | 'json_schema' | 'json_object' | 'prompt';

export class LlmError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(`[${provider}] ${message}`, { cause });
    this.name = 'LlmError';
  }
}
