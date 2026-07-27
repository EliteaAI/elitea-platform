/**
 * Cron field data model (spec §2.3 "Cron editor" row; §9.3 unit S7).
 *
 * `react-js-cron@5.2.0` is rejected because it peers `antd: ">=5.8.0"`, an
 * undeclared second component library (spec §2.3, §2.6). This directory is
 * the hand-rolled MUI replacement. Parity target: `IndexScheduleModal.jsx`
 * (`210-245`) / `PipelineScheduleModal.jsx` (`168-203`) in the old app,
 * whose "Default" mode is `react-js-cron`'s `<Cron>` and whose "Advanced"
 * mode is a raw text field — the raw-text mode is NOT part of this unit
 * (it is a plain `TextField`, already generic; wiring the mode toggle is
 * Wave-2 feature work). This directory owns the structured/"Default" editor.
 *
 * Grammar scope. Both modals validate the resulting expression through
 * `indexSchedule.helpers.js`'s regex family — one alternation per field:
 * wildcard `*` | comma list | single dash range | `*\/N` step. No field ever
 * mixes two of those, and no range/step ever anchors anywhere but `*`. That
 * four-way alternation is exactly `CronFieldKind` below: parity means
 * reproducing that grammar exactly, not the full POSIX cron spec (which also
 * allows anchored steps like `3-30/5`, comma-separated ranges, `L`/`W`/`#`
 * extensions, etc. — none of which the old app's UI or validator ever
 * produces).
 */

export type CronFieldId = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

/** Standard 5-field order: minute hour day(month) month day(week). */
export const CRON_FIELD_ORDER: readonly CronFieldId[] = [
  'minute',
  'hour',
  'dayOfMonth',
  'month',
  'dayOfWeek',
];

export type CronFieldKind = 'every' | 'list' | 'range' | 'step';

// Only `CronFieldRange` is exported on its own — `CronFieldEditor.tsx` names
// it directly (the range handlers take an already-narrowed `CronFieldRange`,
// see its file comment). `Every`/`List`/`Step` are never named outside this
// union; they stay module-private and reach the rest of the app only as
// `CronFieldState` / `CronFieldNonEvery` constituents (R-D1: no dead exports).
interface CronFieldEvery {
  readonly kind: 'every';
}
interface CronFieldList {
  readonly kind: 'list';
  /** Ascending, deduplicated. A single-element list is a "specific value". */
  readonly values: readonly number[];
}
export interface CronFieldRange {
  readonly kind: 'range';
  readonly from: number;
  readonly to: number;
}
interface CronFieldStep {
  readonly kind: 'step';
  /** Cron `*\/step`. The old app's grammar never anchors a step on anything but `*`. */
  readonly step: number;
}

export type CronFieldState = CronFieldEvery | CronFieldList | CronFieldRange | CronFieldStep;

/**
 * `CronFieldState` minus `every` — the domain `describe.ts`'s per-field
 * helpers actually operate on, since their callers only reach them after
 * narrowing out the `every` case. Typing the parameter this way (rather
 * than the full `CronFieldState`) turns "the every case never happens here"
 * from a comment into something `tsc` enforces at the call site.
 */
export type CronFieldNonEvery = CronFieldList | CronFieldRange | CronFieldStep;

export type CronExpressionState = Readonly<Record<CronFieldId, CronFieldState>>;

export interface CronFieldBounds {
  readonly min: number;
  readonly max: number;
  /** Sensible non-degenerate default offered when a field switches to "step". */
  readonly defaultStep: number;
}

/**
 * Field domains. `dayOfWeek`'s canonical domain is 0-6 (Sunday=0); the raw
 * cron convention `7 = Sunday` is accepted on *parse* (both `0` and `7` mean
 * Sunday) and normalised to `0` — see `parse.ts`. This mirrors
 * `indexSchedule.helpers.js`'s `weekdayPattern` (`[0-7]`) while keeping the
 * structured state (and every Select built from it) a plain 0-6 domain.
 */
export const CRON_FIELD_BOUNDS: Readonly<Record<CronFieldId, CronFieldBounds>> = {
  minute: { min: 0, max: 59, defaultStep: 5 },
  hour: { min: 0, max: 23, defaultStep: 2 },
  dayOfMonth: { min: 1, max: 31, defaultStep: 2 },
  month: { min: 1, max: 12, defaultStep: 2 },
  dayOfWeek: { min: 0, max: 6, defaultStep: 2 },
};

/** Not exported: an internal building block for `DEFAULT_EXPRESSION_STATE` only. */
const DEFAULT_FIELD_STATE: CronFieldState = { kind: 'every' };

export const DEFAULT_EXPRESSION_STATE: CronExpressionState = {
  minute: DEFAULT_FIELD_STATE,
  hour: DEFAULT_FIELD_STATE,
  dayOfMonth: DEFAULT_FIELD_STATE,
  month: DEFAULT_FIELD_STATE,
  dayOfWeek: DEFAULT_FIELD_STATE,
};

export type ParseSuccess = { readonly ok: true; readonly state: CronExpressionState };
export type ParseFailure = { readonly ok: false; readonly error: string };
export type ParseResult = ParseSuccess | ParseFailure;

export function rangeArray(min: number, max: number): number[] {
  const out: number[] = [];
  for (let n = min; n <= max; n++) out.push(n);
  return out;
}
