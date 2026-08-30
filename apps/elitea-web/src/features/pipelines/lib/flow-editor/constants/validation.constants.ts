/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/constants/validation.constants.js` (unit A2c).
 * Validation error messages for the Pipeline Flow Editor.
 */

export const ValidationErrors = {
  VariableNameExists: 'Name already exists',
  VariableNameInvalid: 'Only letters, numbers and underscore are allowed. It should start with a letter.',
  /**
   * A state key the pipeline runtime owns. `compiler.rs:1373` runs
   * `reserved_user_state_key` (`compiler.rs:1456`) over every key of the
   * document's own `state:` mapping and rejects the whole pipeline when one
   * matches — see `constants/runtimeContract.constants.ts`'s
   * `ReservedStateKeys` for the transcribed list and its citations.
   */
  VariableNameReserved: 'This name is reserved by the pipeline runtime. Choose another.',
  NumberFormatInvalid: 'Invalid number format',
  ListFormatInvalid: 'Invalid list format. Use JSON array: [1, 2] or ["item1", "item2"]',
  JsonFormatInvalid: 'Invalid JSON format. Use: {"key": "value"}',
} as const;
