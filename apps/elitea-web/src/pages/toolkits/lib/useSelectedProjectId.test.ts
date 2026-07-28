import { describe, expect, it } from 'vitest';

import { selectProjectId } from './useSelectedProjectId';

describe('selectProjectId', () => {
  it('returns undefined for a non-object context', () => {
    expect(selectProjectId(undefined)).toBeUndefined();
    expect(selectProjectId(null)).toBeUndefined();
    expect(selectProjectId('nope')).toBeUndefined();
  });

  it('returns undefined when auth.getSelectedProjectId is absent', () => {
    expect(selectProjectId({})).toBeUndefined();
    expect(selectProjectId({ auth: {} })).toBeUndefined();
  });

  it('returns the id auth.getSelectedProjectId() resolves', () => {
    const context = { auth: { getSelectedProjectId: () => '42' } };
    expect(selectProjectId(context)).toBe('42');
  });

  it('returns undefined when auth.getSelectedProjectId() itself resolves undefined', () => {
    const context = { auth: { getSelectedProjectId: () => undefined } };
    expect(selectProjectId(context)).toBeUndefined();
  });
});
