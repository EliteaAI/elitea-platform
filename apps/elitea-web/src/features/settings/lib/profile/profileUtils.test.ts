import { describe, expect, it } from 'vitest';

import {
  createContextStrategyFormData,
  deserializeProfileFormData,
  parseModelValue,
  PROFILE_INITIAL_VALUES,
  serializeProfileFormData,
} from './profileUtils';

describe('serializeProfileFormData', () => {
  const defaultModel = { name: 'gpt-4', project_id: '10' };

  it('returns defaults with model info when authorData is undefined', () => {
    const result = serializeProfileFormData(undefined, defaultModel);
    expect(result.persona).toBe('');
    expect(result.summary_llm_settings.model_name).toBe('gpt-4');
    expect(result.summary_llm_settings.model_project_id).toBe('10');
  });

  it('serializes personalization persona and instructions', () => {
    const result = serializeProfileFormData({ personalization: { persona: 'friendly', default_instructions: 'Be kind' } }, null);
    expect(result.persona).toBe('friendly');
    expect(result.default_instructions).toBe('Be kind');
  });

  it('defaults persona to generic when empty', () => {
    const result = serializeProfileFormData({ personalization: {} }, null);
    expect(result.persona).toBe('generic');
  });

  it('serializes context management fields', () => {
    const result = serializeProfileFormData({
      personalization: { default_context_management: { enabled: true, max_context_tokens: 8000, preserve_recent_messages: 5 } },
    }, null);
    expect(result.context_enabled).toBe(true);
    expect(result.max_context_tokens).toBe(8000);
    expect(result.preserve_recent_messages).toBe(5);
  });

  it('serializes summarization fields', () => {
    const result = serializeProfileFormData({
      personalization: { default_summarization: { enable_summarization: true, summary_instructions: 'summarize', summary_model_name: 'claude', summary_model_project_id: '42', target_summary_tokens: 2048 } },
    }, null);
    expect(result.enable_summarization).toBe(true);
    expect(result.summary_llm_settings.instructions).toBe('summarize');
    expect(result.summary_llm_settings.model_name).toBe('claude');
    expect(result.summary_llm_settings.model_project_id).toBe('42');
    expect(result.summary_llm_settings.max_tokens).toBe(2048);
  });

  it('falls back to defaultModel for summarization model_name', () => {
    const result = serializeProfileFormData({ personalization: { default_summarization: {} } }, defaultModel);
    expect(result.summary_llm_settings.model_name).toBe('gpt-4');
    expect(result.summary_llm_settings.model_project_id).toBe('10');
  });
});

describe('deserializeProfileFormData', () => {
  it('nests form values under personalization', () => {
    const result = deserializeProfileFormData({
      persona: 'friendly',
      default_instructions: 'hi',
      context_enabled: true,
      max_context_tokens: 8000,
      preserve_recent_messages: 3,
      enable_summarization: false,
      summary_llm_settings: { instructions: 's', model_name: 'm', model_project_id: 'p', max_tokens: 1024 },
    });
    const p = result.personalization as Record<string, unknown>;
    expect(p.persona).toBe('friendly');
    expect(p.default_instructions).toBe('hi');
    const cm = p.default_context_management as Record<string, unknown>;
    expect(cm.enabled).toBe(true);
    expect(cm.max_context_tokens).toBe(8000);
    const s = p.default_summarization as Record<string, unknown>;
    expect(s.enable_summarization).toBe(false);
    expect(s.summary_model_name).toBe('m');
    expect(s.target_summary_tokens).toBe(1024);
  });
});

describe('createContextStrategyFormData', () => {
  it('reshapes formik values into context strategy form data', () => {
    const result = createContextStrategyFormData({
      ...PROFILE_INITIAL_VALUES,
      context_enabled: true,
      max_context_tokens: 5000,
      preserve_recent_messages: 2,
      enable_summarization: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.max_context_tokens).toBe(5000);
    expect(result.preserve_recent_messages).toBe(2);
    expect(result.enable_summarization).toBe(true);
  });
});

describe('parseModelValue', () => {
  it('parses model name and project id from separator-delimited string', () => {
    const result = parseModelValue('gpt-4$$$42');
    expect(result.modelName).toBe('gpt-4');
    expect(result.modelProjectId).toBe(42);
  });

  it('returns null project id when no separator', () => {
    const result = parseModelValue('claude-3');
    expect(result.modelName).toBe('claude-3');
    expect(result.modelProjectId).toBeNull();
  });

  it('handles empty string', () => {
    expect(parseModelValue('')).toEqual({ modelName: '', modelProjectId: null });
  });
});
