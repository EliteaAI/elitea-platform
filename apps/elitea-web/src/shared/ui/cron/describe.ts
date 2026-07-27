/**
 * Human-readable preview text (spec §9.3 unit S7: "a human-readable
 * expression preview").
 *
 * The old app gets this text from `cronstrue` (`indexSchedule.helpers.js:1,
 * 147`: `cronstrue.toString(input, { use24HourTimeFormat: true })`) and
 * renders it in the same slot that shows the validation error
 * (`IndexScheduleModal.jsx:77-82`: `<Typography variant="headingSmall">`,
 * coloured `error.main` when invalid). This module intentionally does NOT
 * depend on `cronstrue` — the spec's own §2.3 mandate for this unit is to
 * hand-roll the field rather than pull in another cron-shaped dependency,
 * and that principle applies equally to the preview text, not just parsing.
 * The phrasing below approximates cronstrue's style (24-hour clock, "At
 * HH:MM, only on <weekday>" cadence) but is NOT byte-identical to it — this
 * is a deliberate N4 deviation, waived per spec §8.4 as parity item
 * `COPY-511` (`parity/manifest/indexes.json`), not merely noted here.
 */
import { t } from '../lib/t';
import { monthFullLabel, weekdayFullLabel } from './labels';
import type { CronExpressionState, CronFieldNonEvery, CronFieldState } from './model';
import { parseCronExpression } from './parse';
import { serializeField } from './serialize';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function singleValue(field: CronFieldState): number | null {
  // `field.values[0]!`: `.length === 1` was just checked, so index 0 is
  // provably present — `noUncheckedIndexedAccess` cannot see that either.
  return field.kind === 'list' && field.values.length === 1 ? field.values[0]! : null;
}

/** `"A"` / `"A and B"` / `"A, B and C"` — no Oxford comma before the final "and". */
function joinWithAnd(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/**
 * Formats an explicit minute-list × hour-list as clock times (waiver
 * COPY-511: this is the fix for the "list-of-times" regression the waiver
 * flags — `"0 8,18 * * *"` now reads "At 08:00 and 18:00" instead of
 * dumping the raw field syntax). Cron semantics for two list fields is a
 * cross-product — every `(hour, minute)` pair fires — so this genuinely
 * enumerates all of them, not just one side. `hour.values`/`minute.values`
 * are already ascending (`parse.ts` sorts+dedupes on parse), so the
 * hour-outer/minute-inner iteration order is already chronological.
 */
function formatTimeList(hours: readonly number[], minutes: readonly number[]): string {
  const times: string[] = [];
  for (const h of hours) {
    for (const m of minutes) {
      times.push(`${pad2(h)}:${pad2(m)}`);
    }
  }
  return joinWithAnd(times);
}

/** Every/list/range/step rendered as plain numbers — the fallback branch's building block. */
function describeGeneric(field: CronFieldState): string {
  return serializeField(field);
}

interface TimeDescription {
  readonly text: string;
  /** True when the phrase names one clock time (`At HH:MM`), not a cadence. */
  readonly isPointInTime: boolean;
}

function describeTime(minute: CronFieldState, hour: CronFieldState): TimeDescription {
  if (minute.kind === 'every' && hour.kind === 'every') {
    return { text: t('shared.ui.cron.time.everyMinute', 'Every minute'), isPointInTime: false };
  }
  if (minute.kind === 'step' && hour.kind === 'every') {
    return {
      text: t('shared.ui.cron.time.everyNMinutes', `Every ${minute.step} minutes`),
      isPointInTime: false,
    };
  }

  const minuteSingle = singleValue(minute);
  if (hour.kind === 'step' && (minute.kind === 'every' || minuteSingle === 0)) {
    return {
      text: t('shared.ui.cron.time.everyNHours', `Every ${hour.step} hours`),
      isPointInTime: false,
    };
  }

  // A single clock time is the length-1×length-1 special case of this —
  // `formatTimeList` degrades to `"HH:MM"` with no "and" for one pair, so
  // this one branch covers both `'0 0 * * 6'` ("At 00:00, …") and
  // `'0 8,18 * * *'` ("At 08:00 and 18:00, …") without duplicating logic.
  if (minute.kind === 'list' && hour.kind === 'list') {
    return {
      text: t('shared.ui.cron.time.at', `At ${formatTimeList(hour.values, minute.values)}`),
      isPointInTime: true,
    };
  }

  return {
    text: t(
      'shared.ui.cron.time.generic',
      `At minute ${describeGeneric(minute)} of hour ${describeGeneric(hour)}`,
    ),
    isPointInTime: true,
  };
}

// The three functions below take `CronFieldNonEvery`, not `CronFieldState`:
// every call site below only reaches them after narrowing its argument's
// `kind` away from `'every'` (control-flow narrowing at the call
// expression), so `tsc` — not a runtime guard — is what proves the `every`
// case is unreachable here. `switch (field.kind)` is exhaustive over the
// remaining three (`typescript/switch-exhaustiveness-check` is "error").
function describeWeekdays(field: CronFieldNonEvery): string {
  switch (field.kind) {
    case 'list':
      return field.values.map(weekdayFullLabel).join(', ');
    case 'range':
      return t(
        'shared.ui.cron.weekdayThrough',
        `${weekdayFullLabel(field.from)} through ${weekdayFullLabel(field.to)}`,
      );
    case 'step':
      return t('shared.ui.cron.weekdayEveryN', `every ${field.step} days of the week`);
  }
}

/** `field.kind` is never `'step'` here — the "every N days" case has its own, non-wrapped phrase below. */
function describeDayOfMonthValues(field: Exclude<CronFieldNonEvery, { kind: 'step' }>): string {
  return field.kind === 'list' ? field.values.join(', ') : `${field.from}-${field.to}`;
}

/** `field.kind` is never `'step'` here — same reasoning as `describeDayOfMonthValues`. */
function describeMonthValues(field: Exclude<CronFieldNonEvery, { kind: 'step' }>): string {
  if (field.kind === 'list') return field.values.map(monthFullLabel).join(', ');
  return t(
    'shared.ui.cron.monthThrough',
    `${monthFullLabel(field.from)} through ${monthFullLabel(field.to)}`,
  );
}

function dayOfMonthPhrase(field: CronFieldNonEvery): string {
  if (field.kind === 'step') {
    return t('shared.ui.cron.dayOfMonthEveryN', `every ${field.step} days`);
  }
  return t('shared.ui.cron.onDayOfMonth', `on day ${describeDayOfMonthValues(field)} of the month`);
}

function monthPhrase(field: CronFieldNonEvery): string {
  if (field.kind === 'step') {
    return t('shared.ui.cron.monthEveryN', `every ${field.step} months`);
  }
  return t('shared.ui.cron.onlyInMonth', `only in ${describeMonthValues(field)}`);
}

function describeDays(dayOfMonth: CronFieldState, dayOfWeek: CronFieldState): string | null {
  const dayPhrase = dayOfMonth.kind !== 'every' ? dayOfMonthPhrase(dayOfMonth) : null;

  if (dayOfWeek.kind === 'every') {
    return dayPhrase;
  }

  const weekdayPhrase = dayPhrase !== null
    ? t('shared.ui.cron.orOnWeekday', `or on ${describeWeekdays(dayOfWeek)}`)
    : t('shared.ui.cron.onlyOnWeekday', `only on ${describeWeekdays(dayOfWeek)}`);

  return dayPhrase !== null ? `${dayPhrase}, ${weekdayPhrase}` : weekdayPhrase;
}

export function describeCronState(state: CronExpressionState): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = state;
  const time = describeTime(minute, hour);
  const days = describeDays(dayOfMonth, dayOfWeek);
  const monthClause = month.kind !== 'every' ? monthPhrase(month) : null;

  if (days === null && monthClause === null) {
    if (time.isPointInTime) {
      return `${time.text}, ${t('shared.ui.cron.everyDay', 'every day')}`;
    }
    return time.text;
  }

  return [time.text, days, monthClause].filter((part): part is string => part !== null).join(', ');
}

export function describeCron(expression: string): string {
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) {
    return t('shared.ui.cron.invalid', 'Invalid cron expression');
  }
  return describeCronState(parsed.state);
}
