/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/helpers/
 * indexSchedule.helpers.js` (unit A4a) — cron-expression validation for the
 * index-schedule modal, with an index-specific "at most once per day" floor
 * on top of the shared minute/hour grammar.
 *
 * DISCLOSED REDESIGN: the baseline hand-rolls its own 5-pattern regex
 * grammar AND calls `cronstrue.toString(...)` for the human-readable
 * preview. Neither survives here unchanged:
 *  - `cronstrue` is not a dependency of this app (`package.json` has no
 *    entry; confirmed via grep) — `shared/ui/cron` (unit S7) was built
 *    specifically to replace `react-js-cron`+`cronstrue` with a hand-rolled
 *    MUI cron field, and its own `parse.ts` doc comment states it "mirrors
 *    the field grammar `indexSchedule.helpers.js` validates against ...
 *    so any expression the old app's validator accepts for a given field
 *    parses here" — i.e. S7 was deliberately built to be THE shared
 *    replacement for this exact grammar. This file now delegates base
 *    5-field/per-field-range validation to S7's `parseCronExpression`
 *    instead of re-deriving the same five regexes a second time, and gets
 *    its human-readable preview from S7's `describeCron` (the baseline's
 *    own COPY-511 parity waiver already accepts hand-rolled-not-cronstrue
 *    preview text for this exact field — see `shared/ui/cron/describe.ts`).
 *  - What this file keeps and S7 does NOT provide: the index-domain
 *    "minimum frequency" business rule (indexing is heavier than a
 *    pipeline run, so schedules may fire at most once per DAY — the
 *    baseline's `validateMinimumDailyFrequency`). S7 is grammar-only, no
 *    domain floor of any kind — that rule stays exactly as this file always
 *    owned it, operating on the raw minute/hour string tokens the same way
 *    the baseline did.
 */
import { describeCron, parseCronExpression } from '@/shared/ui/cron';

export interface CronValidationResult {
  readonly isValid: boolean;
  readonly message: string;
}

const HOURLY_FLOOR_MSG = 'Frequency cannot be less than every hour';
const DAILY_FLOOR_MSG = 'Frequency cannot be more than once per day';

/** The `minute` half of `validateMinimumFrequency`'s hourly-floor check, split out to keep both functions' cyclomatic complexity under the repo's max-12 gate (R-eslint(complexity)) without changing a single branch's evaluation order or outcome. */
function minuteViolatesHourlyFloor(minute: string): boolean {
  if (minute === '*') return true;
  if (minute.includes(',')) return true;

  if (minute.includes('/')) {
    const stepMatch = /\*\/(\d+)/.exec(minute);
    if (stepMatch?.[1] && parseInt(stepMatch[1], 10) < 60) return true;
  }

  if (minute.includes('-')) {
    const rangeMatch = /(\d+)-(\d+)/.exec(minute);
    if (rangeMatch?.[1] && rangeMatch[2] && parseInt(rangeMatch[2], 10) > parseInt(rangeMatch[1], 10)) {
      return true;
    }
  }

  return false;
}

/**
 * The `hour`-step-is-zero syntax check `validateMinimumFrequency` runs
 * AFTER the minute check (see call site — order matters: a minute
 * violation wins over a zero hour-step).
 *
 * DISCLOSED FINDING (not a behavior change): under the baseline's own
 * hand-rolled grammar this branch was reachable — its regex-based hour
 * pattern accepted a zero-value step token as syntactically valid, leaving
 * this business check as the only thing that rejected it. Under this
 * file's disclosed `shared/ui/cron` delegation (see module doc comment),
 * `parseCronExpression` already rejects any step below 1 for every field
 * during shape validation (`parse.ts`'s `parseStep`), so
 * `validateCronExpression` returns that generic "Invalid hour value" error
 * before `validateMinimumFrequency` is ever called — verified empirically:
 * feeding an hour field of a wildcard divided by zero into
 * `parseCronExpression` yields `{ok:false, error:'Invalid hour value: ...'}`.
 * This function and its caller's dedicated message are therefore
 * unreachable through the public `validateCronExpressionDaily` entry point
 * today. Kept rather than deleted: removing it would be a scope decision
 * beyond "fix the complexity lint finding," and it costs nothing to keep
 * as a second line of defence should `shared/ui/cron`'s bounds ever loosen.
 */
function hourStepIsZero(hour: string): boolean {
  if (!hour.includes('/')) return false;
  const stepMatch = /\*\/(\d+)/.exec(hour);
  return stepMatch?.[1] !== undefined && parseInt(stepMatch[1], 10) === 0;
}

function validateMinimumFrequency(minute: string, hour: string): CronValidationResult {
  if (minuteViolatesHourlyFloor(minute)) return { isValid: false, message: HOURLY_FLOOR_MSG };

  if (hourStepIsZero(hour)) {
    return { isValid: false, message: 'Invalid hour step value. Step cannot be 0.' };
  }

  return { isValid: true, message: '' };
}

/**
 * Daily-floor variant used by index scheduling (indexing is heavier than
 * pipeline runs, so we cap it at one execution per day). Reuses the hourly
 * check, but surfaces the daily message — anything that fires more than
 * once per hour also fires more than once per day, and the user is
 * configuring an index schedule, so they should see the index-specific
 * limit.
 */
/** The `hour`-only half of the daily-floor check, split out for the same complexity-budget reason as `minuteViolatesHourlyFloor` above. */
function hourViolatesDailyFloor(hour: string): boolean {
  if (hour === '*') return true;
  if (hour.includes(',')) return true;

  if (hour.includes('-')) {
    const rangeMatch = /(\d+)-(\d+)/.exec(hour);
    if (rangeMatch?.[1] && rangeMatch[2] && parseInt(rangeMatch[2], 10) > parseInt(rangeMatch[1], 10)) {
      return true;
    }
  }

  if (hour.includes('/')) {
    const stepMatch = /\*\/(\d+)/.exec(hour);
    if (stepMatch?.[1] && parseInt(stepMatch[1], 10) < 24) return true;
  }

  return false;
}

function validateMinimumDailyFrequency(minute: string, hour: string): CronValidationResult {
  const hourly = validateMinimumFrequency(minute, hour);
  if (!hourly.isValid) {
    // Preserve "Invalid hour step value. Step cannot be 0." (a syntax-level
    // error, not a frequency-floor violation).
    if (hourly.message.startsWith('Invalid hour step')) return hourly;
    return { isValid: false, message: DAILY_FLOOR_MSG };
  }

  if (hourViolatesDailyFloor(hour)) return { isValid: false, message: DAILY_FLOOR_MSG };

  return { isValid: true, message: '' };
}

/**
 * Base grammar + hourly-floor validation, delegating 5-field/per-field
 * shape checking to `shared/ui/cron`'s `parseCronExpression` (see the file
 * header). Used directly by pipeline schedules (hourly floor only); index
 * scheduling additionally applies `validateCronExpressionDaily` below.
 */
function validateCronExpression(input: string): CronValidationResult {
  const parsed = parseCronExpression(input);
  if (!parsed.ok) return { isValid: false, message: parsed.error };

  const parts = input.trim().split(/\s+/);
  const [minute, hour] = parts;

  const frequencyCheck = validateMinimumFrequency(minute!, hour!);
  if (!frequencyCheck.isValid) return frequencyCheck;

  return { isValid: true, message: describeCron(input) };
}

/**
 * `validateCronExpression` plus the index-specific daily floor. This is
 * what `IndexScheduleModal` validates against.
 */
export function validateCronExpressionDaily(input: string): CronValidationResult {
  const base = validateCronExpression(input);
  if (!base.isValid) {
    // `validateCronExpression` runs the hourly frequency check internally;
    // for the index modal those rejections must surface the daily-floor
    // message instead. Other rejections (syntax errors, hour-step-zero)
    // pass through.
    if (base.message === HOURLY_FLOOR_MSG) return { isValid: false, message: DAILY_FLOOR_MSG };
    return base;
  }

  const parts = input.trim().split(/\s+/);
  const [minute, hour] = parts;

  const dailyCheck = validateMinimumDailyFrequency(minute!, hour!);
  if (!dailyCheck.isValid) return dailyCheck;

  return base;
}
