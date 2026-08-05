import { beforeEach, describe, expect, it } from 'vitest';

import { buildVersionValidationKey, createApplicationsStore, useApplicationsStore } from './applicationsStore';

describe('createApplicationsStore', () => {
  it('starts with the baseline defaults (slices/applications.js initialState)', () => {
    const store = createApplicationsStore();
    const state = store.getState();
    expect(state.isSaving).toBe(false);
    expect(state.shouldRefetchDetails).toBe(false);
    expect(state.versionValidationInfo).toEqual({});
  });

  it('setIsSaving updates only isSaving', () => {
    const store = createApplicationsStore();
    store.getState().setIsSaving(true);
    expect(store.getState().isSaving).toBe(true);
    expect(store.getState().shouldRefetchDetails).toBe(false);
  });

  it('setShouldRefetchDetails updates only shouldRefetchDetails', () => {
    const store = createApplicationsStore();
    store.getState().setShouldRefetchDetails(true);
    expect(store.getState().shouldRefetchDetails).toBe(true);
    expect(store.getState().isSaving).toBe(false);
  });

  it('setVersionValidationInfo merges by key, preserving other keys', () => {
    const store = createApplicationsStore();
    store.getState().setVersionValidationInfo('p_1_2', [{ msg: 'bad' }]);
    store.getState().setVersionValidationInfo('p_1_3', [{ msg: 'also bad' }]);
    expect(store.getState().versionValidationInfo).toEqual({
      p_1_2: [{ msg: 'bad' }],
      p_1_3: [{ msg: 'also bad' }],
    });
  });

  it('setVersionValidationInfo overwrites an existing key rather than appending', () => {
    const store = createApplicationsStore();
    store.getState().setVersionValidationInfo('p_1_2', [{ msg: 'first' }]);
    store.getState().setVersionValidationInfo('p_1_2', []);
    expect(store.getState().versionValidationInfo.p_1_2).toEqual([]);
  });
});

describe('useApplicationsStore (lazy singleton)', () => {
  beforeEach(() => {
    // The module-level singleton persists across tests in the same file;
    // reset the two booleans/keys this suite touches back to defaults.
    useApplicationsStore.setState({ isSaving: false, shouldRefetchDetails: false, versionValidationInfo: {} });
  });

  it('getState/setState operate on the same underlying instance across calls', () => {
    useApplicationsStore.setState({ isSaving: true });
    expect(useApplicationsStore.getState().isSaving).toBe(true);
  });
});

describe('buildVersionValidationKey', () => {
  it('joins projectId/applicationId/versionId with underscores', () => {
    expect(buildVersionValidationKey('proj-1', 42, 7)).toBe('proj-1_42_7');
  });

  it('stringifies undefined segments rather than throwing', () => {
    expect(buildVersionValidationKey(undefined, undefined, undefined)).toBe('undefined_undefined_undefined');
  });
});
