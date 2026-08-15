import { describe, expect, it } from 'vitest';

import { selectPersonalProjectId } from './usePersonalProjectId';

describe('selectPersonalProjectId', () => {
  it('returns undefined for a non-object context', () => {
    expect(selectPersonalProjectId(undefined)).toBeUndefined();
    expect(selectPersonalProjectId(null)).toBeUndefined();
    expect(selectPersonalProjectId('nope')).toBeUndefined();
  });

  it('returns undefined when auth.getUser is absent', () => {
    expect(selectPersonalProjectId({})).toBeUndefined();
    expect(selectPersonalProjectId({ auth: {} })).toBeUndefined();
  });

  it('returns undefined when auth.getUser() resolves no user', () => {
    expect(selectPersonalProjectId({ auth: { getUser: () => undefined } })).toBeUndefined();
  });

  it('returns undefined when the user carries no personal project', () => {
    expect(selectPersonalProjectId({ auth: { getUser: () => ({}) } })).toBeUndefined();
  });

  it('returns the id the user carries', () => {
    expect(selectPersonalProjectId({ auth: { getUser: () => ({ personal_project_id: '7' }) } })).toBe('7');
  });
});
