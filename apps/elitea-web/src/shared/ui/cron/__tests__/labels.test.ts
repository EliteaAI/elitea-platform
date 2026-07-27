import { describe, expect, it } from 'vitest';

import { monthFullLabel, monthShortLabel, weekdayFullLabel, weekdayShortLabel } from '../labels';

describe('weekday labels (canonical domain: 0=Sunday .. 6=Saturday)', () => {
  it('returns the short and full names for every in-domain value', () => {
    expect(weekdayShortLabel(0)).toBe('Sun');
    expect(weekdayFullLabel(0)).toBe('Sunday');
    expect(weekdayShortLabel(6)).toBe('Sat');
    expect(weekdayFullLabel(6)).toBe('Saturday');
    expect(weekdayFullLabel(3)).toBe('Wednesday');
  });

  it('falls back to Sunday for an out-of-domain index', () => {
    expect(weekdayShortLabel(-1)).toBe('Sun');
    expect(weekdayFullLabel(9)).toBe('Sunday');
  });
});

describe('month labels (cron domain: 1=January .. 12=December)', () => {
  it('returns the short and full names for every in-domain value', () => {
    expect(monthShortLabel(1)).toBe('Jan');
    expect(monthFullLabel(1)).toBe('January');
    expect(monthShortLabel(12)).toBe('Dec');
    expect(monthFullLabel(12)).toBe('December');
    expect(monthFullLabel(6)).toBe('June');
  });

  it('falls back to January for an out-of-domain index', () => {
    expect(monthShortLabel(0)).toBe('Jan');
    expect(monthFullLabel(13)).toBe('January');
  });
});
