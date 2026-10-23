import { describe, expect, it } from 'vitest';
import { loadLlmEnv, LlmEnvValidationError } from '../src/env.js';

describe('loadLlmEnv', () => {
  it('applies dev defaults with zero configuration', () => {
    const env = loadLlmEnv({});
    expect(env.baseUrl).toBe('http://localhost:11434/v1');
    expect(env.model).toBe('llama3.2');
    expect(env.apiKey).toBeUndefined();
    expect(env.maxOutputTokens).toBe(8000);
    expect(env.timeoutMs).toBe(120_000);
    expect(env.jsonMode).toBe('auto');
    expect(env.extraBody).toEqual({});
  });

  it('reads every variable when set', () => {
    const env = loadLlmEnv({
      LLM_BASE_URL: 'https://api.deepseek.com/v1',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'deepseek-chat',
      LLM_MAX_OUTPUT_TOKENS: '4000',
      LLM_TIMEOUT_MS: '30000',
      LLM_JSON_MODE: 'json_object',
      LLM_EXTRA_BODY: '{"enable_thinking":false}',
    });
    expect(env).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      maxOutputTokens: 4000,
      timeoutMs: 30_000,
      jsonMode: 'json_object',
      extraBody: { enable_thinking: false },
    });
  });

  it('treats an empty LLM_API_KEY as unset', () => {
    const env = loadLlmEnv({ LLM_API_KEY: '' });
    expect(env.apiKey).toBeUndefined();
  });

  it('rejects an invalid LLM_JSON_MODE', () => {
    expect(() => loadLlmEnv({ LLM_JSON_MODE: 'yolo' })).toThrow(LlmEnvValidationError);
  });

  it('rejects LLM_EXTRA_BODY that is not valid JSON', () => {
    expect(() => loadLlmEnv({ LLM_EXTRA_BODY: 'not json' })).toThrow(LlmEnvValidationError);
  });
});
