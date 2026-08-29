/**
 * The rules here are all "what the worker will accept", so each case names
 * the failure it prevents rather than the branch it covers. Every one of
 * them fails LATE if it regresses: the version saves with a 200 and only the
 * first chat message reports anything.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@/shared/lib/constants';

import { writeAgentLlmSettings } from './writeAgentLlmSettings';

const GPT = { name: 'gpt-4o', projectId: '17', supportsReasoning: false } as const;
const REASONER = { name: 'o3-mini', projectId: 17, supportsReasoning: true } as const;

describe('writeAgentLlmSettings', () => {
  it('coerces the catalogue project id to a number, whichever way the catalogue spelled it', () => {
    expect(writeAgentLlmSettings(GPT, undefined)?.model_project_id).toBe(17);
    expect(writeAgentLlmSettings(REASONER, undefined)?.model_project_id).toBe(17);
  });

  it('writes temperature for a model that does not reason', () => {
    const settings = writeAgentLlmSettings(GPT, { temperature: 0.3 });
    expect(settings).toEqual({ model_name: 'gpt-4o', model_project_id: 17, max_tokens: DEFAULT_MAX_TOKENS, temperature: 0.3 });
  });

  it('omits temperature entirely for a reasoning model, even when one is handed in', () => {
    const settings = writeAgentLlmSettings(REASONER, { temperature: 0.3 });
    expect(settings && 'temperature' in settings).toBe(false);
  });

  it('never carries reasoning_effort, whichever model is chosen', () => {
    expect(writeAgentLlmSettings(REASONER, { temperature: 0.3 })).not.toHaveProperty('reasoning_effort');
    expect(writeAgentLlmSettings(GPT, { temperature: 0.3 })).not.toHaveProperty('reasoning_effort');
  });

  it('clamps a temperature past the worker ceiling instead of saving one it refuses', () => {
    // The slider travels to 2.0; `parse_temperature` accepts 0.0..=1.0.
    expect(writeAgentLlmSettings(GPT, { temperature: 1.8 })?.temperature).toBe(1);
    expect(writeAgentLlmSettings(GPT, { temperature: -1 })?.temperature).toBe(0);
  });

  it('defaults an absent temperature rather than leaving the key off a non-reasoning model', () => {
    expect(writeAgentLlmSettings(GPT, {})?.temperature).toBe(DEFAULT_TEMPERATURE);
  });

  it('parses the max-tokens field the dialog hands back as a string', () => {
    expect(writeAgentLlmSettings(GPT, { max_tokens: '4096' })?.max_tokens).toBe(4096);
  });

  it('falls back to auto for a max-tokens field that is blank or unparsable', () => {
    expect(writeAgentLlmSettings(GPT, { max_tokens: '' })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(writeAgentLlmSettings(GPT, {})?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it('refuses to build a profile with no usable project id', () => {
    expect(writeAgentLlmSettings({ ...GPT, projectId: undefined }, {})).toBeUndefined();
    expect(writeAgentLlmSettings({ ...GPT, projectId: 'public' }, {})).toBeUndefined();
    expect(writeAgentLlmSettings({ ...GPT, projectId: 0 }, {})).toBeUndefined();
  });

  it('refuses to build a profile with no model name', () => {
    expect(writeAgentLlmSettings({ ...GPT, name: '' }, {})).toBeUndefined();
  });
});
