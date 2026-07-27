import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPRESSION_STATE } from '../model';
import { serializeCronState, serializeField } from '../serialize';

describe('serializeField', () => {
  it('serializes "every" as "*"', () => {
    expect(serializeField({ kind: 'every' })).toBe('*');
  });

  it('serializes a single-value list without a comma', () => {
    expect(serializeField({ kind: 'list', values: [6] })).toBe('6');
  });

  it('serializes a multi-value list joined by commas, in the given order', () => {
    expect(serializeField({ kind: 'list', values: [3, 5, 10] })).toBe('3,5,10');
  });

  it('serializes a range as "from-to"', () => {
    expect(serializeField({ kind: 'range', from: 1, to: 5 })).toBe('1-5');
  });

  it('serializes a step as "*/N"', () => {
    expect(serializeField({ kind: 'step', step: 15 })).toBe('*/15');
  });
});

describe('serializeCronState', () => {
  it('joins the 5 fields with single spaces, in minute-hour-day-month-weekday order', () => {
    const expression = serializeCronState({
      minute: { kind: 'list', values: [0] },
      hour: { kind: 'list', values: [0] },
      dayOfMonth: { kind: 'every' },
      month: { kind: 'every' },
      dayOfWeek: { kind: 'list', values: [6] },
    });
    expect(expression).toBe('0 0 * * 6');
  });

  it('serializes the all-every default state as "* * * * *"', () => {
    expect(serializeCronState(DEFAULT_EXPRESSION_STATE)).toBe('* * * * *');
  });
});
