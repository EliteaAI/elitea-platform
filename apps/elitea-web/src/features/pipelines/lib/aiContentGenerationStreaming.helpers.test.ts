import { describe, expect, it } from 'vitest';

import { buildLlmSettings, convertSocketContent, getServicePromptDefaultsByKey, readGenerationBlocker } from './aiContentGenerationStreaming.helpers';
import type { AiAssistantConfigurationTypeDescriptor } from '../api/aiAssistantConfigurations';

describe('convertSocketContent', () => {
  it('returns an empty string for null/undefined', () => {
    expect(convertSocketContent(null)).toBe('');
    expect(convertSocketContent(undefined)).toBe('');
  });

  it('passes a string through unchanged', () => {
    expect(convertSocketContent('hello')).toBe('hello');
  });

  it('JSON-stringifies non-string content', () => {
    expect(convertSocketContent({ a: 1 })).toBe('{"a":1}');
    expect(convertSocketContent(42)).toBe('42');
  });
});

describe('readGenerationBlocker', () => {
  it('blocks when there is no socket id', () => {
    expect(readGenerationBlocker(undefined, 'gpt-4', 7)).toBe('Socket connection not available');
  });

  it('blocks when there is no model name', () => {
    expect(readGenerationBlocker('sid', undefined, 7)).toBe('No LLM model configured. Please configure a model in the pipeline settings.');
  });

  it('blocks when there is no projectId', () => {
    expect(readGenerationBlocker('sid', 'gpt-4', undefined)).toBe('No project selected.');
  });

  it('returns null when all preconditions are met', () => {
    expect(readGenerationBlocker('sid', 'gpt-4', 7)).toBeNull();
  });
});

describe('buildLlmSettings', () => {
  it('defaults temperature and max_tokens when absent', () => {
    const result = buildLlmSettings({ model_name: 'gpt-4' } as never);
    expect(result).toEqual({ model_name: 'gpt-4', temperature: 0.7, max_tokens: 1024 });
  });

  it('omits integration_uid when undefined (exactOptionalPropertyTypes-safe)', () => {
    const result = buildLlmSettings({ model_name: 'gpt-4', temperature: 0.5, max_tokens: 500 });
    expect('integration_uid' in result).toBe(false);
  });

  it('includes integration_uid when provided', () => {
    const result = buildLlmSettings({ model_name: 'gpt-4', integration_uid: 'int-1', temperature: 0.5, max_tokens: 500 });
    expect(result.integration_uid).toBe('int-1');
  });
});

describe('getServicePromptDefaultsByKey', () => {
  it('returns an empty object when availableTypes is undefined', () => {
    expect(getServicePromptDefaultsByKey(undefined)).toEqual({});
  });

  it('returns an empty object when no service_prompt entry exists', () => {
    const types: AiAssistantConfigurationTypeDescriptor[] = [{ type: 'llm', config_schema: {} }];
    expect(getServicePromptDefaultsByKey(types)).toEqual({});
  });

  it('extracts default_by_key from the service_prompt entry config_schema', () => {
    const types: AiAssistantConfigurationTypeDescriptor[] = [
      {
        type: 'service_prompt',
        config_schema: {
          properties: { data: { properties: { prompt: { default_by_key: { llm_task_assistant: 'default text' } } } } },
        },
      },
    ];
    expect(getServicePromptDefaultsByKey(types)).toEqual({ llm_task_assistant: 'default text' });
  });
});
