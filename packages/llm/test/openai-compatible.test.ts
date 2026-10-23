import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleClient } from '../src/openai-compatible.js';
import { LlmError } from '../src/types.js';

const TestSchema = z.object({ answer: z.string() });

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function chatCompletion(
  content: string,
  overrides: {
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  } = {},
): unknown {
  return {
    model: overrides.model ?? 'test-model',
    choices: [{ message: { content } }],
    usage: overrides.usage ?? { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

interface FakeRequestBody {
  stream?: boolean;
  response_format?: { type: string };
  messages: { role: string; content: string }[];
}

function requestBody(mock: ReturnType<typeof vi.fn>, callIndex: number): FakeRequestBody {
  const call = mock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string) as FakeRequestBody;
}

describe('OpenAiCompatibleClient', () => {
  it('complete() returns text, usage and model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, chatCompletion('hello')));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'test-model',
      fetchImpl: asFetch(fetchImpl),
    });

    const result = await client.complete({ system: 's', user: 'u' });

    expect(result.value).toBe('hello');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe('test-model');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(requestBody(fetchImpl, 0).stream).toBe(false);
  });

  it('completeJson in json_schema mode sends a schema and parses the result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, chatCompletion(JSON.stringify({ answer: '42' }))));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'json_schema',
      fetchImpl: asFetch(fetchImpl),
    });

    const result = await client.completeJson({
      system: 's',
      user: 'u',
      schema: TestSchema,
      schemaName: 'Test',
    });

    expect(result.value).toEqual({ answer: '42' });
    expect(requestBody(fetchImpl, 0).response_format?.type).toBe('json_schema');
  });

  it('completeJson in json_object mode renders the schema into the prompt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, chatCompletion(JSON.stringify({ answer: '42' }))));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'json_object',
      fetchImpl: asFetch(fetchImpl),
    });

    const result = await client.completeJson({
      system: 's',
      user: 'u',
      schema: TestSchema,
      schemaName: 'Test',
    });

    expect(result.value).toEqual({ answer: '42' });
    const body = requestBody(fetchImpl, 0);
    expect(body.response_format?.type).toBe('json_object');
    expect(body.messages[1]?.content).toContain('schema');
  });

  it('completeJson in prompt mode strips a fenced code block', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, chatCompletion('```json\n{"answer":"42"}\n```')));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'prompt',
      fetchImpl: asFetch(fetchImpl),
    });

    const result = await client.completeJson({
      system: 's',
      user: 'u',
      schema: TestSchema,
      schemaName: 'Test',
    });

    expect(result.value).toEqual({ answer: '42' });
    expect(requestBody(fetchImpl, 0).response_format).toBeUndefined();
  });

  it('auto mode downgrades past a rejected mode and caches the one that worked', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { response_format?: { type: string } };
      if (body.response_format?.type === 'json_schema') {
        return Promise.resolve(jsonResponse(400, { error: 'response_format not supported' }));
      }
      return Promise.resolve(jsonResponse(200, chatCompletion(JSON.stringify({ answer: 'ok' }))));
    });
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });

    const first = await client.completeJson({
      system: 's',
      user: 'u',
      schema: TestSchema,
      schemaName: 'Test',
    });
    expect(first.value).toEqual({ answer: 'ok' });
    // json_schema attempt rejected (1) + json_object attempt accepted (1) = 2.
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    fetchImpl.mockClear();
    const second = await client.completeJson({
      system: 's',
      user: 'u2',
      schema: TestSchema,
      schemaName: 'Test',
    });
    expect(second.value).toEqual({ answer: 'ok' });
    // The resolved mode is cached — no re-probing on the next call.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('performs one repair round when the response fails schema validation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, chatCompletion('not json at all')))
      .mockResolvedValueOnce(
        jsonResponse(200, chatCompletion(JSON.stringify({ answer: 'fixed' }))),
      );
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'prompt',
      fetchImpl: asFetch(fetchImpl),
    });

    const result = await client.completeJson({
      system: 's',
      user: 'u',
      schema: TestSchema,
      schemaName: 'Test',
    });

    expect(result.value).toEqual({ answer: 'fixed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchImpl, 1).messages[1]?.content).toContain(
      'previous response was invalid',
    );
  });

  it('throws LlmError when the repair attempt also fails schema validation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, chatCompletion('still not json')));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'prompt',
      fetchImpl: asFetch(fetchImpl),
    });

    await expect(
      client.completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' }),
    ).rejects.toThrow(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries once on a 429 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(jsonResponse(200, chatCompletion('ok')));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
      retryBaseDelayMs: 1,
    });

    const result = await client.complete({ system: 's', user: 'u' });

    expect(result.value).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries on repeated 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'down' }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
      retryBaseDelayMs: 1,
      maxRetries: 1,
    });

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('does not retry a non-retryable 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
      retryBaseDelayMs: 1,
    });

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('wraps a timeout in LlmError with a clear message', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    });
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
      timeoutMs: 5,
    });

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/timed out/);
  });

  it('throws LlmError on a malformed response envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { nonsense: true }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(LlmError);
  });

  it('sends no authorization header when apiKey is omitted, and one when it is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, chatCompletion('hi')));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });
    await client.complete({ system: 's', user: 'u' });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();

    fetchImpl.mockClear();
    const keyed = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      apiKey: 'secret',
      fetchImpl: asFetch(fetchImpl),
    });
    await keyed.complete({ system: 's', user: 'u' });
    const [, keyedInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((keyedInit.headers as Record<string, string>).authorization).toBe('Bearer secret');
  });
});
