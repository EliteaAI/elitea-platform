import { DEFAULT_MAX_TOKENS, REASONING_MIN_TOKENS } from '@/shared/lib/constants';

export const VALIDATION_RULE = {
  EXCEEDS_MODEL_LIMIT: 'EXCEEDS_MODEL_LIMIT',
  REASONING_MIN_TOKENS: 'REASONING_MIN_TOKENS',
  VALID: 'VALID',
} as const;

export type ValidationRule = (typeof VALIDATION_RULE)[keyof typeof VALIDATION_RULE];

export const validateMaxTokens = (
  maxTokens: number | string | undefined,
  selectedModel?: { max_output_tokens?: number; supports_reasoning?: boolean },
): ValidationRule => {
  if (maxTokens === DEFAULT_MAX_TOKENS) return VALIDATION_RULE.VALID;
  const numTokens = typeof maxTokens === 'string' ? parseInt(maxTokens, 10) : (maxTokens ?? 0);
  if (selectedModel?.max_output_tokens !== undefined && numTokens > selectedModel.max_output_tokens)
    return VALIDATION_RULE.EXCEEDS_MODEL_LIMIT;
  if (selectedModel?.supports_reasoning && numTokens < REASONING_MIN_TOKENS)
    return VALIDATION_RULE.REASONING_MIN_TOKENS;
  return VALIDATION_RULE.VALID;
};

export const getMaxTokensHelperText = (
  validationResult: ValidationRule,
  selectedModel?: { max_output_tokens?: number },
): string | undefined => {
  switch (validationResult) {
    case VALIDATION_RULE.EXCEEDS_MODEL_LIMIT:
      return `Maximum output tokens value exceeded the model limit: ${selectedModel?.max_output_tokens}`;
    case VALIDATION_RULE.REASONING_MIN_TOKENS:
      return `Minimum ${REASONING_MIN_TOKENS} tokens required for reasoning models`;
    case VALIDATION_RULE.VALID:
    default:
      return undefined;
  }
};
