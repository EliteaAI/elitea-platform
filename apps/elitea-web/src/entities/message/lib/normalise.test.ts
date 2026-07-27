import { describe, expect, it } from 'vitest';

import { convertTime } from './normalise';

describe('convertTime', () => {
  it('converts a space-separated Postgres-style timestamp to ISO', () => {
    expect(convertTime('2026-01-01 12:30:00')).toBe('2026-01-01T12:30:00Z');
  });

  it('returns a timestamp already ending in Z unchanged', () => {
    expect(convertTime('2026-01-01T12:30:00Z')).toBe('2026-01-01T12:30:00Z');
  });

  it('returns a timestamp with a + offset unchanged', () => {
    expect(convertTime('2026-01-01T12:30:00+02:00')).toBe('2026-01-01T12:30:00+02:00');
  });

  it('appends Z to a bare timestamp with none of the above', () => {
    expect(convertTime('2026-01-01T12:30:00')).toBe('2026-01-01T12:30:00Z');
  });

  it('is idempotent for the appended-Z case, matching parseability', () => {
    const once = convertTime('2026-01-01T12:30:00');
    expect(new Date(once).toString()).not.toBe('Invalid Date');
  });
});
