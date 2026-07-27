import { describe, expect, it } from 'vitest';

import { describeCron, describeCronState } from '../describe';
import { DEFAULT_EXPRESSION_STATE } from '../model';
import { parseCronExpression } from '../parse';

function describeExpression(expression: string): string {
  const parsed = parseCronExpression(expression);
  if (!parsed.ok) throw new Error(`fixture expression failed to parse: ${expression}`);
  return describeCronState(parsed.state);
}

describe('describeCron — invalid input', () => {
  it('returns a fixed message for an unparseable expression', () => {
    expect(describeCron('not a cron')).toBe('Invalid cron expression');
  });

  it('delegates to describeCronState for a valid expression', () => {
    expect(describeCron('0 0 * * 6')).toBe(describeExpression('0 0 * * 6'));
  });
});

describe('describeCronState — time phrase', () => {
  it('describes "every minute" for a fully wildcard time', () => {
    expect(describeExpression('* * * * *')).toBe('Every minute');
  });

  it('describes a minute step with hour=every as "Every N minutes"', () => {
    expect(describeExpression('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('describes an hour step with minute=every as "Every N hours"', () => {
    expect(describeExpression('* */2 * * *')).toBe('Every 2 hours');
  });

  it('describes an hour step with minute=0 as "Every N hours"', () => {
    expect(describeExpression('0 */2 * * *')).toBe('Every 2 hours');
  });

  it('describes single minute+hour values as "At HH:MM"', () => {
    expect(describeExpression('0 0 * * *')).toBe('At 00:00, every day');
    expect(describeExpression('5 9 * * *')).toBe('At 09:05, every day');
  });

  // Waiver COPY-511's non-cosmetic-regression fix: a single minute crossed
  // with a list of hours (or vice versa) is a genuine list of clock times,
  // not raw field syntax — the case the coordinator's review named
  // explicitly ("0 8,18 * * *").
  it('describes a single minute crossed with a two-hour list as "At H1:MM and H2:MM"', () => {
    expect(describeExpression('0 8,18 * * *')).toBe('At 08:00 and 18:00, every day');
  });

  it('describes a single minute crossed with a three-hour list, no Oxford comma before the final "and"', () => {
    expect(describeExpression('0 8,12,18 * * *')).toBe('At 08:00, 12:00 and 18:00, every day');
  });

  it('describes a single hour crossed with a two-minute list', () => {
    expect(describeExpression('0,30 9 * * *')).toBe('At 09:00 and 09:30, every day');
  });

  it('describes a genuine minute-list × hour-list as the full cross-product, chronologically ordered', () => {
    // Cron semantics: every (hour, minute) PAIR fires, i.e. 4 times here —
    // not just "hours 9 and 17 at minute 0 or 30" read as two independent
    // lists. hour.values/minute.values are already ascending, so hour-outer/
    // minute-inner iteration is already chronological.
    expect(describeExpression('0,30 9,17 * * *')).toBe(
      'At 09:00, 09:30, 17:00 and 17:30, every day',
    );
  });

  it('falls back to a generic minute/hour phrase for combinations outside the idiomatic cases', () => {
    // Neither branch matches: hour is a step but minute is a nonzero single
    // value (not "every" and not 0), so this exercises the fallback, not
    // the "every N hours" shorthand.
    expect(describeExpression('30 */2 * * *')).toBe('At minute 30 of hour */2, every day');
    // A minute list (not a single value) with hour=every also falls back.
    expect(describeExpression('5,10 * * * *')).toBe('At minute 5,10 of hour *, every day');
  });
});

describe('describeCronState — day/weekday phrase', () => {
  it('says "every day" when dayOfMonth, month, and dayOfWeek are all wildcards and the time is a point', () => {
    expect(describeExpression('0 0 * * *')).toBe('At 00:00, every day');
  });

  it('omits the day suffix entirely when the time itself is already a cadence, not a point', () => {
    expect(describeExpression('* * * * *')).toBe('Every minute');
  });

  it('describes a single weekday as "only on <Weekday>"', () => {
    expect(describeExpression('0 0 * * 6')).toBe('At 00:00, only on Saturday');
  });

  it('describes a weekday list', () => {
    expect(describeExpression('0 9 * * 1,3,5')).toBe('At 09:00, only on Monday, Wednesday, Friday');
  });

  it('describes a weekday range as "X through Y"', () => {
    expect(describeExpression('0 9 * * 1-5')).toBe('At 09:00, only on Monday through Friday');
  });

  it('describes a weekday step', () => {
    expect(describeExpression('0 0 * * */2')).toBe('At 00:00, only on every 2 days of the week');
  });

  it('describes a dayOfMonth value as "on day N of the month"', () => {
    expect(describeExpression('0 0 1 * *')).toBe('At 00:00, on day 1 of the month');
  });

  it('describes both dayOfMonth and dayOfWeek set as an "or" combination (cron OR semantics)', () => {
    expect(describeExpression('0 0 1 * 6')).toBe(
      'At 00:00, on day 1 of the month, or on Saturday',
    );
  });
});

describe('describeCronState — month phrase', () => {
  it('appends "only in <Month>" when month is restricted', () => {
    expect(describeExpression('0 0 1 1 *')).toBe('At 00:00, on day 1 of the month, only in January');
  });

  it('appends only the month phrase (no redundant "every day") when day/weekday are both wildcard', () => {
    expect(describeExpression('0 0 * 6 *')).toBe('At 00:00, only in June');
  });
});

describe('describeCronState — dayOfMonth range/step', () => {
  it('describes a dayOfMonth range as "on day N-M of the month"', () => {
    expect(describeExpression('0 0 10-15 * *')).toBe('At 00:00, on day 10-15 of the month');
  });

  it('describes a dayOfMonth step as a standalone "every N days" (no "on day ... of the month" wrapper)', () => {
    expect(describeExpression('0 0 */5 * *')).toBe('At 00:00, every 5 days');
  });
});

describe('describeCronState — month range/step', () => {
  it('describes a month range as "only in <Month> through <Month>"', () => {
    expect(describeExpression('0 0 * 3-6 *')).toBe('At 00:00, only in March through June');
  });

  it('describes a month step as a standalone "every N months" (no "only in" wrapper)', () => {
    expect(describeExpression('0 0 * */3 *')).toBe('At 00:00, every 3 months');
  });
});

describe('describeCronState — default (all-every) state', () => {
  it('describes the default expression state as "Every minute"', () => {
    expect(describeCronState(DEFAULT_EXPRESSION_STATE)).toBe('Every minute');
  });
});
