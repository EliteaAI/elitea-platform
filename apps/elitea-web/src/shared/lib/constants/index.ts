/**
 * Shared constants — copied from the old-app's `[fsd]/shared/lib/constants/`.
 */

export const AccordionConstants = {
  AccordionShowMode: {
    RightMode: 'right',
    LeftMode: 'left',
  },
} as const;

/** LLM model settings defaults from `[fsd]/shared/lib/constants/llmSettings.constants.js`. */
const REASONING_EFFORT_VALUES = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;

export const DEFAULT_MAX_TOKENS = -1;
export const DEFAULT_MAX_TOKENS_CUSTOM = 4096;
export const DEFAULT_TEMPERATURE = 0.6;
export const DEFAULT_REASONING_EFFORT = REASONING_EFFORT_VALUES.Medium;
export const REASONING_MIN_TOKENS = 4096;
export const DEFAULT_STEPS_LIMIT = 25;
