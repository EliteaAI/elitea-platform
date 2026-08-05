import { describe, expect, it } from 'vitest';

import { selectProjectId } from './useSelectedProjectId';

describe('selectProjectId', () => {
  it('reads the selected project from router auth context', () => {
    expect(selectProjectId({ auth: { getSelectedProjectId: () => 'project-1' } })).toBe('project-1');
  });

  it('returns undefined for missing or malformed context', () => {
    expect(selectProjectId(null)).toBeUndefined();
    expect(selectProjectId({})).toBeUndefined();
  });
});
