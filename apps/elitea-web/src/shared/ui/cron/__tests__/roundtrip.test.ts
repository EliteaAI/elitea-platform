/**
 * Parity round-trip: parse(expression) -> serialize(state) must reproduce
 * `expression` byte-for-byte, for the set of expressions the OLD app's two
 * schedule modals actually produce or default to.
 *
 * Parity targets (old app, main checkout, read-only):
 *  - `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/constants/
 *     indexDetails.constants.js:42` — `IndexCronDefault = '0 0 * * 6'`
 *  - `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/settings/
 *     PipelineScheduleModal.jsx:14` — `PipelineCronDefault = '0 0 * * 6'`
 *    (byte-identical to the index default — both modals default a new
 *    schedule to "every Saturday at midnight")
 *
 * Both modals' "Default" mode is `react-js-cron`'s `<Cron>` with no
 * `allowedPeriods`/`allowedDropdowns` restriction, i.e. the full default
 * grammar (wildcard | comma list | dash range | `*\/N` step per field) —
 * exactly this component's grammar (`model.ts`'s file comment). The set
 * below is representative of what a user picking minute/hour/day/month/
 * weekday values through that (or this) UI can produce, imported through
 * the public barrel (`..`) since that is the contract Wave-2 consumers use.
 */
import { describe, expect, it } from 'vitest';

import { parseCronExpression, serializeCronState } from '..';

const REPRESENTATIVE_EXPRESSIONS = [
  // Both modals' literal default — the load-bearing case.
  '0 0 * * 6',
  // Every minute (the grammar's simplest wildcard-only expression).
  '* * * * *',
  // Hourly, on the hour.
  '0 * * * *',
  // Daily at a specific time.
  '0 0 * * *',
  '30 14 * * *',
  // Weekly, a specific weekday at a specific time.
  '15 9 * * 1',
  // A weekday range (Monday through Friday).
  '0 9 * * 1-5',
  // A weekday list.
  '0 9 * * 1,3,5',
  // Monthly, a specific day of month.
  '0 0 1 * *',
  // Yearly.
  '0 0 1 1 *',
  // A minute step ("every 5 minutes").
  '*/5 * * * *',
  // An hour step ("every 2 hours").
  '0 */2 * * *',
  // A day-of-month range with a month restriction.
  '0 0 1-5 6 *',
] as const;

describe('parse -> serialize round-trip (parity with the old app)', () => {
  it.each(REPRESENTATIVE_EXPRESSIONS)('reproduces "%s" byte-for-byte', (expression) => {
    const parsed = parseCronExpression(expression);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeCronState(parsed.state)).toBe(expression);
  });

  it('round-trips the shared IndexCronDefault/PipelineCronDefault value specifically', () => {
    const OLD_APP_DEFAULT = '0 0 * * 6';
    const parsed = parseCronExpression(OLD_APP_DEFAULT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeCronState(parsed.state)).toBe(OLD_APP_DEFAULT);
  });
});
