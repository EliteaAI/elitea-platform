import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useIndexesStore } from '../../model/indexesStore';
import type { IndexRow } from '../../model/indexesStore';

import { useIndexNameValidation } from './useIndexNameValidation.hooks';

beforeEach(() => {
  useIndexesStore.setState({ tempIndexes: [], indexPatches: {}, toolkitScheduler: {}, selectedHistoryItem: null });
});

const serverIndexes: IndexRow[] = [{ id: '1', metadata: { collection: 'existing-index' } }];

describe('useIndexNameValidation', () => {
  it('starts with no error', () => {
    const { result } = renderHook(() => useIndexNameValidation(serverIndexes));
    expect(result.current.indexNameError).toBeNull();
  });

  it('isIndexNameValid is false for a name already present in the server list', () => {
    const { result } = renderHook(() => useIndexNameValidation(serverIndexes));
    expect(result.current.isIndexNameValid('existing-index')).toBe(false);
    expect(result.current.isIndexNameValid('brand-new-name')).toBe(true);
  });

  it('isIndexNameValid also sees names from the local temp-index overlay', () => {
    useIndexesStore.getState().addTempLocalIndex({ id: 'new_index', metadata: { collection: 'temp-name' } });
    const { result } = renderHook(() => useIndexNameValidation(serverIndexes));
    expect(result.current.isIndexNameValid('temp-name')).toBe(false);
  });

  it('updateIndexNameError sets a "already exists" message; clearIndexNameError clears it', () => {
    const { result } = renderHook(() => useIndexNameValidation(serverIndexes));
    act(() => result.current.updateIndexNameError('existing-index'));
    expect(result.current.indexNameError).toBe('Index "existing-index" already exists');
    act(() => result.current.clearIndexNameError());
    expect(result.current.indexNameError).toBeNull();
  });
});
