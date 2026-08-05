import { describe, expect, it } from 'vitest';

import { setFieldValueAtPath } from './agentFieldChange';

describe('setFieldValueAtPath', () => {
  it('sets a top-level field', () => {
    expect(setFieldValueAtPath({ name: 'old' }, 'name', 'new')).toEqual({ name: 'new' });
  });

  it('sets a nested field, creating intermediate objects that do not exist yet', () => {
    expect(setFieldValueAtPath({}, 'version_details.instructions', 'Do things')).toEqual({
      version_details: { instructions: 'Do things' },
    });
  });

  it('sets a deeply nested field without disturbing sibling fields', () => {
    const input = { version_details: { instructions: 'keep', meta: { step_limit: 10, internal_tools: [] } } };
    const result = setFieldValueAtPath(input, 'version_details.meta.step_limit', 25);
    expect(result).toEqual({ version_details: { instructions: 'keep', meta: { step_limit: 25, internal_tools: [] } } });
  });

  it('does not mutate the original object', () => {
    const input = { name: 'old' };
    setFieldValueAtPath(input, 'name', 'new');
    expect(input).toEqual({ name: 'old' });
  });

  it('preserves sibling top-level fields', () => {
    const input = { name: 'Agent', description: 'desc' };
    expect(setFieldValueAtPath(input, 'description', 'new desc')).toEqual({ name: 'Agent', description: 'new desc' });
  });

  it('replaces an array value wholesale (e.g. variables)', () => {
    const input = { version_details: { variables: [{ name: 'a', value: '1' }] } };
    const result = setFieldValueAtPath(input, 'version_details.variables', [{ name: 'b', value: '2' }]);
    expect(result).toEqual({ version_details: { variables: [{ name: 'b', value: '2' }] } });
  });
});
