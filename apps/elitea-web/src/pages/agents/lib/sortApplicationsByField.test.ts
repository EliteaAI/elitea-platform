import { describe, expect, it } from 'vitest';

import { sortApplicationsByField } from './sortApplicationsByField';

interface Row {
  readonly name: string;
  readonly createdAt: string;
}

const ROWS: readonly Row[] = [
  { name: 'Charlie', createdAt: '2026-01-03T00:00:00Z' },
  { name: 'Alpha', createdAt: '2026-01-01T00:00:00Z' },
  { name: 'Bravo', createdAt: '2026-01-02T00:00:00Z' },
];

function getField(row: Row, field: 'name' | 'createdAt'): string {
  return row[field];
}

describe('sortApplicationsByField', () => {
  it('sorts by name ascending', () => {
    const sorted = sortApplicationsByField(ROWS, 'name', 'asc', getField);
    expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by name descending', () => {
    const sorted = sortApplicationsByField(ROWS, 'name', 'desc', getField);
    expect(sorted.map((r) => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts by createdAt ascending', () => {
    const sorted = sortApplicationsByField(ROWS, 'createdAt', 'asc', getField);
    expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by createdAt descending', () => {
    const sorted = sortApplicationsByField(ROWS, 'createdAt', 'desc', getField);
    expect(sorted.map((r) => r.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('does not mutate the input array', () => {
    const copy = [...ROWS];
    sortApplicationsByField(ROWS, 'name', 'asc', getField);
    expect(ROWS).toEqual(copy);
  });
});
