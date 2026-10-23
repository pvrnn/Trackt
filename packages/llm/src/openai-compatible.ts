import { z } from 'zod';
import { toJsonSchema } from './json-schema.js';
import { LlmError } from './types.js';
import type { LlmClient, LlmJsonMode, LlmJsonRequest, LlmRequest, LlmResult } from './types.js';

export interface OpenAiCompatibleClientOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  jsonMode?: LlmJsonMode;
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Base backoff delay for 429/5xx retries; overridable so tests don't sleep for real. */
  retryBaseDelayMs?: number;
}

interface ChatResult {
  content: string | null | undefined;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

interface JsonModeExtras {
  responseFormat?: Record<string, unknown>;
  promptSuffix?: string;
}

const ChatCompletionResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

type ResolvedJsonMode = Exclude<LlmJsonMode, 'auto'>;

const JSON_MODE_LADDER: readonly ResolvedJsonMode[] = ['json_schema', 'json_object', 'prompt'];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

/**
 * The one adapter that reaches every OpenAI-compatible endpoint — Qwen, Kimi,
 * DeepSeek, OpenRouter, a local Ollama/vLLM, OpenAI, Anthropic's compatible
 * endpoint — by changing config, never code (news-and-newsroom-plan.md Phase 0).
 */
export class OpenAiCompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly jsonMode: LlmJsonMode;
  private readonly extraBody: Record<string, unknown>;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  /** Cached once `jsonMode: 'auto'` finds a mode the provider accepts. */
  private resolvedJsonMode?: ResolvedJsonMode;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.jsonMode = options.jsonMode ?? 'auto';
    this.extraBody = options.extraBody ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  async complete(req: LlmRequest): Promise<LlmResult<string>> {
    const result = await this.chat(req, {});
    if (result.content === null || result.content === undefined) {
      throw new LlmError('openai-compatible', 'response contained no content');
    }
    return { value: result.content, usage: result.usage, model: result.model };
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmResult<T>> {
    const modesToTry: readonly ResolvedJsonMode[] =
      this.jsonMode !== 'auto'
        ? [this.jsonMode]
        : this.resolvedJsonMode
          ? [this.resolvedJsonMode]
          : JSON_MODE_LADDER;

    let lastError: unknown;
    for (const mode of modesToTry) {
      let raw: ChatResult;
      try {
        raw = await this.chat(req, this.buildJsonModeExtras(mode, req));
      } catch (error) {
        // This mode isn't supported by the provider (a rejected response_format,
        // typically) — try the next one. One extra round trip, not a hard failure.
        lastError = error;
        continue;
      }

      if (this.jsonMode === 'auto') this.resolvedJsonMode = mode;
      const parsed = await this.parseJsonWithRepair(req, raw.content ?? '', mode);
      return { value: parsed, usage: raw.usage, model: raw.model };
    }

    throw new LlmError(
      'openai-compatible',
      `no supported JSON mode produced a response (tried: ${modesToTry.join(', ')})`,
      undefined,
      lastError,
    );
  }

  private buildJsonModeExtras<T>(mode: ResolvedJsonMode, req: LlmJsonRequest<T>): JsonModeExtras {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    if (mode === 'json_schema') {
      return {
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: jsonSchema, strict: true },
        },
      };
    }
    if (mode === 'json_object') {
      return {
        responseFormat: { type: 'json_object' },
        promptSuffix: `\n\nRespond with a single JSON object matching this schema, and nothing else:\n${JSON.stringify(jsonSchema)}`,
      };
    }
    return {
      promptSuffix: `\n\nRespond with a single JSON object matching this schema, and nothing else. Do not wrap it in a code fence.\n${JSON.stringify(jsonSchema)}`,
    };
  }

  /** Parses `rawContent` against `req.schema`, allowing exactly one repair round trip. */
  private async parseJsonWithRepair<T>(
    req: LlmJsonRequest<T>,
    rawContent: string,
    mode: ResolvedJsonMode,
  ): Promise<T> {
    const attempt = (text: string): { ok: true; value: T } | { ok: false; error: string } => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(stripCodeFence(text));
      } catch (error) {
        return { ok: false, error: `invalid JSON: ${(error as Error).message}` };
      }
      const result = req.schema.safeParse(candidate);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, error: result.error.message };
    };

    const first = attempt(rawContent);
    if (first.ok) return first.value;

    const repaired = await this.chat(
      {
        system: req.system,
        user: `${req.user}\n\nYour previous response was invalid: ${first.error}\n\nPrevious response:\n${rawContent}\n\nReply again with only the corrected JSON, matching the schema.`,
        maxOutputTokens: req.maxOutputTokens,
        extraBody: req.extraBody,
      },
      this.buildJsonModeExtras(mode, req),
    );
    const second = attempt(repaired.content ?? '');
    if (second.ok) return second.value;

    throw new LlmError(
      'openai-compatible',
      `response did not match schema "${req.schemaName}" after one repair attempt: ${second.error}`,
    );
  }

  private async chat(req: LlmRequest, jsonExtras: JsonModeExtras): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user + (jsonExtras.promptSuffix ?? '') },
      ],
      max_tokens: req.maxOutputTokens ?? this.maxOutputTokens,
      stream: false,
      ...this.extraBody,
      ...(req.extraBody ?? {}),
      ...(jsonExtras.responseFormat ? { response_format: jsonExtras.responseFormat } : {}),
    };

    const json = await this.postWithRetry(body);
    const parsed = ChatCompletionResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new LlmError(
        'openai-compatible',
        `malformed response envelope: ${parsed.error.message}`,
      );
    }
    const choice = parsed.data.choices[0];
    return {
      content: choice?.message.content,
      usage: {
        inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      },
      model: parsed.data.model ?? this.model,
    };
  }

  private async postWithRetry(body: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new LlmError(
          'openai-compatible',
          (error as Error).name === 'TimeoutError'
            ? `request timed out after ${this.timeoutMs}ms`
            : `request failed: ${(error as Error).message}`,
          undefined,
          error,
        );
      }

      if (response.ok) return response.json();

      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await sleep(this.retryBaseDelayMs * 2 ** attempt);
        continue;
      }

      const text = await response.text().catch(() => '');
      throw new LlmError(
        'openai-compatible',
        `POST /chat/completions → ${response.status}${text ? `: ${text}` : ''}`,
        response.status,
      );
    }
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
