import { describe, expect, it } from 'vitest';

import {
  areAgentLlmSettingsEqual,
  toAgentLlmSettings,
  toLlmSettingsBody,
  type AgentLlmSettings,
} from './agentLlmSettings';

const PICKED: AgentLlmSettings = {
  model_name: 'qwen3.5',
  model_project_id: 17,
  max_tokens: -1,
  temperature: 0.6,
};

describe('toAgentLlmSettings', () => {
  it('reads a complete stored blob back', () => {
    expect(toAgentLlmSettings({ model_name: 'qwen3.5', model_project_id: 17, max_tokens: 4096, temperature: 0.2 })).toEqual(
      { model_name: 'qwen3.5', model_project_id: 17, max_tokens: 4096, temperature: 0.2 },
    );
  });

  // The export/import path normalises the id to a numeric string, so a stored
  // version can legitimately hold one.
  it('coerces a stringified model_project_id to a number', () => {
    const settings = toAgentLlmSettings({ model_name: 'qwen3.5', model_project_id: '17' });
    expect(settings?.model_project_id).toBe(17);
    expect(typeof settings?.model_project_id).toBe('number');
  });

  // Every version written before the model picker existed stores `{}`, and it
  // is the platform's catalogue-default fallback that makes those agents
  // answer turns. Returning a fabricated object here would replace a working
  // fallback with a guess.
  it('returns undefined for the empty object every pre-feature version stores', () => {
    expect(toAgentLlmSettings({})).toBeUndefined();
  });

  it('returns undefined for a non-object, null, or undefined', () => {
    expect(toAgentLlmSettings(undefined)).toBeUndefined();
    expect(toAgentLlmSettings(null)).toBeUndefined();
    expect(toAgentLlmSettings('qwen3.5')).toBeUndefined();
  });

  // The worker's `positive_u32` hard-fails without a project id, so a blob
  // that names only a model is not a profile this app may author.
  it('returns undefined when the model name or the project id is missing', () => {
    expect(toAgentLlmSettings({ model_name: 'qwen3.5' })).toBeUndefined();
    expect(toAgentLlmSettings({ model_project_id: 17 })).toBeUndefined();
    expect(toAgentLlmSettings({ model_name: '', model_project_id: 17 })).toBeUndefined();
  });

  it('defaults max_tokens to -1 (Auto) when the blob carries none', () => {
    expect(toAgentLlmSettings({ model_name: 'qwen3.5', model_project_id: 17 })?.max_tokens).toBe(-1);
  });

  // `top_p` is in the OpenAPI schema but not in the worker's allow-list, and
  // `openai_compatible` is re-derived server-side; carrying either forward
  // turns a green save into a refused turn.
  it('drops keys outside the worker allow-list rather than carrying them forward', () => {
    const settings = toAgentLlmSettings({
      model_name: 'qwen3.5',
      model_project_id: 17,
      top_p: 0.9,
      openai_compatible: true,
    });
    expect(settings).toEqual({ model_name: 'qwen3.5', model_project_id: 17, max_tokens: -1 });
    expect(settings).not.toHaveProperty('top_p');
    expect(settings).not.toHaveProperty('openai_compatible');
  });

  it('omits temperature entirely rather than setting it undefined', () => {
    const settings = toAgentLlmSettings({ model_name: 'qwen3.5', model_project_id: 17 });
    expect(Object.hasOwn(settings ?? {}, 'temperature')).toBe(false);
  });
});

describe('toLlmSettingsBody', () => {
  it('sends model_project_id as a JSON number', () => {
    expect(toLlmSettingsBody(PICKED).model_project_id).toBe(17);
    expect(JSON.parse(JSON.stringify(toLlmSettingsBody(PICKED)))).toEqual({
      model_name: 'qwen3.5',
      model_project_id: 17,
      max_tokens: -1,
      temperature: 0.6,
    });
  });

  it('omits temperature when the settings carry none', () => {
    const body = toLlmSettingsBody({ model_name: 'qwen3.5', model_project_id: 17, max_tokens: -1 });
    expect(Object.hasOwn(body, 'temperature')).toBe(false);
  });
});

describe('areAgentLlmSettingsEqual', () => {
  it('compares key by key, not by identity', () => {
    expect(areAgentLlmSettingsEqual(PICKED, { ...PICKED })).toBe(true);
  });

  it('sees a changed model, temperature, or max_tokens', () => {
    expect(areAgentLlmSettingsEqual(PICKED, { ...PICKED, model_name: 'gpt-4o' })).toBe(false);
    expect(areAgentLlmSettingsEqual(PICKED, { ...PICKED, model_project_id: 18 })).toBe(false);
    expect(areAgentLlmSettingsEqual(PICKED, { ...PICKED, temperature: 0.9 })).toBe(false);
    expect(areAgentLlmSettingsEqual(PICKED, { ...PICKED, max_tokens: 4096 })).toBe(false);
  });

  it('treats picking a first model as a change', () => {
    expect(areAgentLlmSettingsEqual(undefined, PICKED)).toBe(false);
    expect(areAgentLlmSettingsEqual(PICKED, undefined)).toBe(false);
    expect(areAgentLlmSettingsEqual(undefined, undefined)).toBe(true);
  });
});
