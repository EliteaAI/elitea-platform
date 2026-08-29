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

  it('never carries reasoning_effort onto a model that does not reason', () => {
    expect(writeAgentLlmSettings(GPT, { temperature: 0.3, reasoning_effort: 'high' })).not.toHaveProperty(
      'reasoning_effort',
    );
  });

  /*
   * #611-review-3. `reasoning_effort` is a key the worker honours
   * (`ModelFieldNames::APPLICATION`), and dropping it on the way out is what
   * silently moved a reasoning agent off the effort its author picked.
   */
  it('carries reasoning_effort for a model that reasons', () => {
    expect(writeAgentLlmSettings(REASONER, { reasoning_effort: 'high' })?.reasoning_effort).toBe('high');
  });

  it('drops a reasoning_effort the worker would refuse rather than saving it', () => {
    // `parse_reasoning_effort` accepts only low/medium/high/none.
    expect(writeAgentLlmSettings(REASONER, { reasoning_effort: 'extreme' })).not.toHaveProperty('reasoning_effort');
  });

  /*
   * The exclusion, in both directions. The settings dialog seeds
   * `temperature` on mount for EVERY model, so the reasoning case arrives
   * carrying both and the worker refuses that pair outright.
   */
  it('applies the temperature/reasoning_effort exclusion by the chosen model', () => {
    const reasoning = writeAgentLlmSettings(REASONER, { temperature: 0.3, reasoning_effort: 'low' });
    expect(reasoning?.reasoning_effort).toBe('low');
    expect(reasoning && 'temperature' in reasoning).toBe(false);

    // Moving a version that held an effort onto a model that does not reason
    // must drop the effort, not carry it alongside the new temperature.
    const plain = writeAgentLlmSettings(GPT, { temperature: 0.3, reasoning_effort: 'low' });
    expect(plain?.temperature).toBe(0.3);
    expect(plain && 'reasoning_effort' in plain).toBe(false);
  });

  it('emits neither key for a reasoning model with no effort to carry', () => {
    const settings = writeAgentLlmSettings(REASONER, { temperature: 0.3 });
    expect(settings && 'reasoning_effort' in settings).toBe(false);
    expect(settings && 'temperature' in settings).toBe(false);
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

  /*
   * #611-review-2. `0` parses, is finite, and SAVES with a 200 — and then
   * every turn is refused `invalid_profile`, because
   * `normalized_max_tokens` sends anything that is not `-1` through
   * `positive_u32` (`*value > 0`). It must never reach the version.
   */
  it('never writes a max_tokens of 0, whichever way the field spelled it', () => {
    expect(writeAgentLlmSettings(GPT, { max_tokens: 0 })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(writeAgentLlmSettings(GPT, { max_tokens: '0' })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it('never writes a negative max_tokens other than -1, nor a fractional one', () => {
    expect(writeAgentLlmSettings(GPT, { max_tokens: -5 })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(writeAgentLlmSettings(GPT, { max_tokens: 4096.5 })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    // -1 is Auto and stays.
    expect(writeAgentLlmSettings(GPT, { max_tokens: -1 })?.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    // The smallest value the worker will actually run is kept as typed.
    expect(writeAgentLlmSettings(GPT, { max_tokens: 1 })?.max_tokens).toBe(1);
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
