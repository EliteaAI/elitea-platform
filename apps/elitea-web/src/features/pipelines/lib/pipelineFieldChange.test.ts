import { describe, expect, it } from 'vitest';

import { setFieldValueAtPath } from './pipelineFieldChange';

describe('setFieldValueAtPath', () => {
  it('sets a top-level field immutably', () => {
    const original = { name: 'a' };
    const next = setFieldValueAtPath(original, 'name', 'b');
    expect(next).toEqual({ name: 'b' });
    expect(original).toEqual({ name: 'a' });
  });

  it('sets a nested field, creating intermediate objects as needed', () => {
    const original = {};
    const next = setFieldValueAtPath(original, 'version_details.instructions', 'do the thing') as {
      version_details: { instructions: string };
    };
    expect(next.version_details.instructions).toBe('do the thing');
  });

  it('preserves sibling fields at every level', () => {
    const original = { version_details: { instructions: 'x', tags: ['a'] } };
    const next = setFieldValueAtPath(original, 'version_details.instructions', 'y');
    expect(next.version_details.instructions).toBe('y');
    expect(next.version_details.tags).toEqual(['a']);
  });
});
