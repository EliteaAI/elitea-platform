/**
 * One conversation-participant variable row, as read/written by
 * `VariablesEditor.tsx`/`VariableDialog.tsx`. Baseline
 * (`components/VariableList.jsx`): each item is keyed by `key || name` and
 * carries a `value` string — `key` is the DB-stable identifier when
 * present, `name` is the display/fallback identifier otherwise (both are
 * read defensively across the baseline's three call sites).
 */
export interface AgentVariable {
  readonly key?: string;
  readonly name?: string;
  readonly value: string;
}
