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
    finishReason?: string;
  } = {},
): unknown {
  return {
    model: overrides.model ?? 'test-model',
    choices: [{ message: { content }, finish_reason: overrides.finishReason ?? 'stop' }],
    usage: overrides.usage ?? { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

interface FakeRequestBody {
  stream?: boolean;
  response_format?: { type: string; json_schema?: { strict: boolean } };
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

  it('auto mode surfaces an auth failure instead of walking the ladder', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });

    const error = await client
      .completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('auto mode does not retry a timeout on the next rung', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    });
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });

    await expect(
      client.completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' }),
    ).rejects.toThrow(/timed out/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('auto mode throws the last rung’s own error when every rung is rejected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'context too long' }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    });

    const error = await client
      .completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' })
      .catch((caught: unknown) => caught);

    expect((error as LlmError).status).toBe(400);
    expect((error as LlmError).message).toContain('context too long');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('sends strict json_schema only for a schema strict mode accepts', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, chatCompletion(JSON.stringify({ answer: '42' }))));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'json_schema',
      fetchImpl: asFetch(fetchImpl),
    });

    await client.completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' });
    await client.completeJson({
      system: 's',
      user: 'u',
      schema: z.object({ answer: z.string(), note: z.string().optional() }),
      schemaName: 'Loose',
    });

    expect(requestBody(fetchImpl, 0).response_format?.json_schema?.strict).toBe(true);
    expect(requestBody(fetchImpl, 1).response_format?.json_schema?.strict).toBe(false);
  });

  it('counts the repair round in usage', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          chatCompletion('nope', { usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          chatCompletion(JSON.stringify({ answer: 'fixed' }), {
            usage: { prompt_tokens: 30, completion_tokens: 7 },
          }),
        ),
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

    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 12 });
  });

  it('fails a truncated JSON response without spending a repair round', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, chatCompletion('{"answer": "4', { finishReason: 'length' })),
      );
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.test/v1',
      model: 'm',
      jsonMode: 'prompt',
      maxOutputTokens: 64,
      fetchImpl: asFetch(fetchImpl),
    });

    await expect(
      client.completeJson({ system: 's', user: 'u', schema: TestSchema, schemaName: 'Test' }),
    ).rejects.toThrow(/cut off at max_tokens \(64\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a reasoning block', '<think>\nThe user wants {"answer"}.\n</think>\n{"answer":"42"}'],
    ['a reasoning block before a fence', '<think>hm</think>\n```json\n{"answer":"42"}\n```'],
    ['surrounding prose', 'Here is the JSON you asked for:\n{"answer":"42"}\nHope that helps!'],
  ])('parses JSON wrapped in %s without a repair round', async (_label, content) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, chatCompletion(content)));
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
