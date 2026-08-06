import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_TOKENS, REASONING_MIN_TOKENS } from '@/shared/lib/constants';

import { getMaxTokensHelperText, VALIDATION_RULE, validateMaxTokens } from './validation';

describe('validateMaxTokens', () => {
  it('returns VALID for DEFAULT_MAX_TOKENS regardless of model', () => {
    expect(validateMaxTokens(DEFAULT_MAX_TOKENS, { max_output_tokens: 100 })).toBe(VALIDATION_RULE.VALID);
  });

  it('returns VALID when tokens are within model limit', () => {
    expect(validateMaxTokens(4096, { max_output_tokens: 8192 })).toBe(VALIDATION_RULE.VALID);
  });

  it('returns EXCEEDS_MODEL_LIMIT when tokens exceed model max', () => {
    expect(validateMaxTokens(10000, { max_output_tokens: 8192 })).toBe(VALIDATION_RULE.EXCEEDS_MODEL_LIMIT);
  });

  it('returns REASONING_MIN_TOKENS when reasoning model has too few tokens', () => {
    expect(validateMaxTokens(100, { supports_reasoning: true, max_output_tokens: 8192 })).toBe(
      VALIDATION_RULE.REASONING_MIN_TOKENS,
    );
  });

  it('parses string tokens', () => {
    expect(validateMaxTokens('10000', { max_output_tokens: 8192 })).toBe(VALIDATION_RULE.EXCEEDS_MODEL_LIMIT);
  });

  it('defaults to 0 when maxTokens is undefined', () => {
    expect(validateMaxTokens(undefined, { supports_reasoning: true, max_output_tokens: 8192 })).toBe(
      VALIDATION_RULE.REASONING_MIN_TOKENS,
    );
  });

  it('returns VALID when no model provided and tokens are not DEFAULT', () => {
    expect(validateMaxTokens(4096)).toBe(VALIDATION_RULE.VALID);
  });

  it('checks model limit before reasoning minimum', () => {
    expect(validateMaxTokens(20000, { supports_reasoning: true, max_output_tokens: 8192 })).toBe(
      VALIDATION_RULE.EXCEEDS_MODEL_LIMIT,
    );
  });
});

describe('getMaxTokensHelperText', () => {
  it('returns model limit message for EXCEEDS_MODEL_LIMIT', () => {
    const text = getMaxTokensHelperText(VALIDATION_RULE.EXCEEDS_MODEL_LIMIT, { max_output_tokens: 8192 });
    expect(text).toContain('8192');
  });

  it('returns reasoning message for REASONING_MIN_TOKENS', () => {
    const text = getMaxTokensHelperText(VALIDATION_RULE.REASONING_MIN_TOKENS);
    expect(text).toContain(String(REASONING_MIN_TOKENS));
  });

  it('returns undefined for VALID', () => {
    expect(getMaxTokensHelperText(VALIDATION_RULE.VALID)).toBeUndefined();
  });
});
