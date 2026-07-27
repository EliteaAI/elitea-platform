import { describe, expect, it } from 'vitest';

import { resolveVersionTags, resolveVersionVariables } from './normalise';

describe('resolveVersionVariables', () => {
  it('prefers top-level variables over meta.variables', () => {
    const result = resolveVersionVariables({
      variables: [{ name: 'top', value: '1' }],
      meta: { variables: [{ name: 'nested', value: '2' }] },
    });
    expect(result).toEqual([{ name: 'top', value: '1' }]);
  });

  it('falls back to meta.variables when the top-level array is absent', () => {
    const result = resolveVersionVariables({
      meta: { variables: [{ name: 'nested', value: '2' }] },
    });
    expect(result).toEqual([{ name: 'nested', value: '2' }]);
  });

  it('drops entries with a null name', () => {
    const result = resolveVersionVariables({
      variables: [{ name: 'kept', value: '1' }, { name: null, value: 'orphan' }],
    });
    expect(result).toEqual([{ name: 'kept', value: '1' }]);
  });

  it('returns an empty array when nothing is present anywhere', () => {
    expect(resolveVersionVariables({})).toEqual([]);
  });
});

describe('resolveVersionTags', () => {
  it('drops tags with a null name', () => {
    const result = resolveVersionTags([
      { name: 'kept', data: { a: 1 } },
      { name: null, data: 'orphan' },
    ]);
    expect(result).toEqual([{ name: 'kept', data: { a: 1 } }]);
  });

  it('omits the data key when absent rather than setting it to undefined', () => {
    const result = resolveVersionTags([{ name: 'no-data' }]);
    expect(result).toEqual([{ name: 'no-data' }]);
    expect(Object.keys(result[0] ?? {})).toEqual(['name']);
  });

  it('returns an empty array for an empty input', () => {
    expect(resolveVersionTags([])).toEqual([]);
  });
});
