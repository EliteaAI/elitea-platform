/**
 * Cron expression -> structured state (spec §9.3 unit S7).
 *
 * Mirrors the field grammar `indexSchedule.helpers.js` validates against
 * (wildcard | comma list | single dash range | `*\/N` step), so any
 * expression the old app's validator accepts for a given field parses here,
 * and anything this parser accepts round-trips through `serializeCronState`
 * byte-for-byte (proven in `__tests__/roundtrip.test.ts`) for the canonical
 * (sorted, deduplicated) form a UI built on this state can ever produce.
 */
import type { CronFieldId, CronFieldState, ParseResult } from './model';
import { CRON_FIELD_BOUNDS, CRON_FIELD_ORDER } from './model';

const STEP_RE = /^\*\/(\d+)$/;
const RANGE_RE = /^(\d+)-(\d+)$/;
const LIST_RE = /^\d+(?:,\d+)*$/;

/**
 * Validates a single raw integer against the field's domain and normalises
 * `dayOfWeek`'s `7` (POSIX "Sunday") down to the canonical `0`. Returns
 * `null` when out of range.
 *
 * Applied per-endpoint, this makes a `dayOfWeek` range whose upper bound is
 * literally `7` (e.g. `"5-7"`) normalise to `from=5, to=0`, which then fails
 * the `from <= to` check in `parseRange` below — i.e. such a range is
 * rejected, not wrapped. That is intentional, not an oversight: neither old
 * modal's weekday UI is a from-to range picker (`react-js-cron`'s weekday
 * control is a multi-select of individual days), so no Sunday-boundary-
 * crossing range like `"5-7"` or `"6-1"` is anything this editor's Range
 * mode needs to reproduce. See `__tests__/parse.test.ts`.
 */
function normalizeValue(raw: number, fieldId: CronFieldId): number | null {
  // No `Number.isInteger` guard: every call site passes `Number(token)`
  // where `token` already matched a `\d+`-only regex (STEP_RE/RANGE_RE/
  // LIST_RE), so `raw` is always a non-negative integer here.
  if (fieldId === 'dayOfWeek') {
    if (raw < 0 || raw > 7) return null;
    return raw === 7 ? 0 : raw;
  }
  const bounds = CRON_FIELD_BOUNDS[fieldId];
  if (raw < bounds.min || raw > bounds.max) return null;
  return raw;
}

function parseStep(raw: string, fieldId: CronFieldId): CronFieldState | null {
  const match = STEP_RE.exec(raw);
  if (!match) return null;
  // STEP_RE's capture group is mandatory (`(\d+)`, not `(\d+)?`), so it is
  // always present whenever `match` is non-null.
  const step = Number(match[1]!);
  const bounds = CRON_FIELD_BOUNDS[fieldId];
  if (step < 1 || step > bounds.max) return null;
  return { kind: 'step', step };
}

function parseRange(raw: string, fieldId: CronFieldId): CronFieldState | null {
  const match = RANGE_RE.exec(raw);
  if (!match) return null;
  // Both RANGE_RE capture groups are mandatory, same reasoning as above.
  const from = normalizeValue(Number(match[1]!), fieldId);
  const to = normalizeValue(Number(match[2]!), fieldId);
  if (from === null || to === null || from > to) return null;
  return { kind: 'range', from, to };
}

function parseList(raw: string, fieldId: CronFieldId): CronFieldState | null {
  if (!LIST_RE.test(raw)) return null;
  const values: number[] = [];
  for (const token of raw.split(',')) {
    const value = normalizeValue(Number(token), fieldId);
    if (value === null) return null;
    values.push(value);
  }
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  return { kind: 'list', values: unique };
}

function parseFieldToken(raw: string, fieldId: CronFieldId): CronFieldState | null {
  if (raw === '*') return { kind: 'every' };
  return parseStep(raw, fieldId) ?? parseRange(raw, fieldId) ?? parseList(raw, fieldId);
}

const FIELD_NOUN: Readonly<Record<CronFieldId, string>> = {
  minute: 'minute',
  hour: 'hour',
  dayOfMonth: 'day',
  month: 'month',
  dayOfWeek: 'weekday',
};

export function parseCronExpression(expression: string): ParseResult {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return { ok: false, error: 'Cron expression is required' };
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, error: 'Cron must have exactly 5 parts with space between every part' };
  }

  const state = {} as Record<CronFieldId, CronFieldState>;
  for (let i = 0; i < CRON_FIELD_ORDER.length; i++) {
    // Both operands are provably in range: CRON_FIELD_ORDER has exactly 5
    // entries (the loop bound) and `parts.length === 5` was just checked —
    // `noUncheckedIndexedAccess` cannot see either invariant, hence the
    // assertions instead of a runtime guard that could never actually fail.
    const fieldId = CRON_FIELD_ORDER[i]!;
    const raw = parts[i]!;
    const parsed = parseFieldToken(raw, fieldId);
    if (!parsed) {
      return { ok: false, error: `Invalid ${FIELD_NOUN[fieldId]} value: "${raw}"` };
    }
    state[fieldId] = parsed;
  }

  return { ok: true, state };
}
