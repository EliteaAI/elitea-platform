import { DEFAULT_MAX_TOKENS, REASONING_MIN_TOKENS } from '@/shared/lib/constants';

export const VALIDATION_RULE = {
  EXCEEDS_MODEL_LIMIT: 'EXCEEDS_MODEL_LIMIT',
  REASONING_MIN_TOKENS: 'REASONING_MIN_TOKENS',
  BELOW_MIN_TOKENS: 'BELOW_MIN_TOKENS',
  VALID: 'VALID',
} as const;

/**
 * The floor the Rust worker enforces, mirrored here so the dialog refuses the
 * value instead of the runtime.
 *
 * `assembly.rs`'s `normalized_max_tokens` treats `-1` as Auto and sends every
 * other value through `positive_u32`, which requires `> 0`. Without this
 * check `0` passed validation, the Apply button stayed enabled, the version
 * SAVED with a 200 — and then every turn was refused `invalid_profile` by an
 * error naming no field at all.
 */
const MIN_MAX_TOKENS = 1;

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
  // Guarded on `undefined` rather than on `numTokens`: the coercion above
  // turns an absent value into `0`, and an absent value is the ordinary state
  // between mount and `computeMissingDefaults` seeding Auto. Flagging it
  // would put a red field on screen for a value the user never typed. A blank
  // string parses to `NaN`, which fails this comparison and stays VALID for
  // the same reason — `LLMSettings`'s blur handler resets it to Auto.
  if (maxTokens !== undefined && numTokens < MIN_MAX_TOKENS) return VALIDATION_RULE.BELOW_MIN_TOKENS;
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
    case VALIDATION_RULE.BELOW_MIN_TOKENS:
      return `Maximum output tokens must be at least ${MIN_MAX_TOKENS}, or -1 for Auto`;
    case VALIDATION_RULE.VALID:
    default:
      return undefined;
  }
};
