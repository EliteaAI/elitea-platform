/**
 * Public surface of `shared/ui/cron` (spec §9.3 unit S7). Nothing outside
 * this directory should deep-import `./CronField` etc. directly.
 *
 * `@public` marks the exports meant for Wave-2 consumers (the index/pipeline
 * schedule modals) that do not exist yet in this tree — same knip
 * convention `shared/brand/index.ts` established for unit F4's Wave-1
 * surface, so `npx knip --max-issues 0` does not flag forward-looking
 * exports as dead.
 */

/** @public Wave-2 surface — the field itself. */
export { CronField } from './CronField';
export type { CronFieldProps } from './CronField';

/** @public Wave-2 surface — parse/serialize for callers that need the raw string, not just the widget. */
export { parseCronExpression } from './parse';
export { serializeCronState } from './serialize';

/** @public Wave-2 surface — human-readable preview, usable outside the widget (e.g. a read-only schedule summary). */
export { describeCron, describeCronState } from './describe';

/** @public Wave-2 surface — the preset vocabulary, for callers that want to offer it outside the dropdown. */
export { CRON_PRESETS, findMatchingPresetId, presetLabel } from './presets';
export type { CronPreset } from './presets';

export type {
  CronExpressionState,
  CronFieldBounds,
  CronFieldId,
  CronFieldKind,
  CronFieldState,
  ParseFailure,
  ParseResult,
  ParseSuccess,
} from './model';
export { CRON_FIELD_BOUNDS, CRON_FIELD_ORDER, DEFAULT_EXPRESSION_STATE } from './model';
