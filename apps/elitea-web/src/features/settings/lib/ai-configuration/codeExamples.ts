/**
 * Constants for AI configuration code-example generation.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/constants/codeExamples.constants.js`.
 */

export const CODE_EXAMPLE_TYPES = {
  CURL: 'curl',
  NODEJS: 'nodejs',
  PYTHON: 'python',
} as const;

export const CODE_EXAMPLE_LABELS: Record<string, string> = {
  [CODE_EXAMPLE_TYPES.CURL]: 'cURL',
  [CODE_EXAMPLE_TYPES.NODEJS]: 'Node.js',
  [CODE_EXAMPLE_TYPES.PYTHON]: 'Python',
};

