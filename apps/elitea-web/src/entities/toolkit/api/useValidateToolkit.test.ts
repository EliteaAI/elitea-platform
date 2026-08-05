import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  buildToolkitValidationKey,
  useToolkitValidationInfo,
  useToolkitValidationStore,
  useValidateToolkit,
} from './useValidateToolkit';
import type { UseValidateToolkitQuery } from './useValidateToolkit';

function resetStore(): void {
  useToolkitValidationStore.getState().setToolkitValidationInfo('__reset__', []);
  const keys = Object.keys(useToolkitValidationStore.getState().infoByKey);
  for (const key of keys) {
    useToolkitValidationStore.getState().setToolkitValidationInfo(key, []);
  }
}

describe('buildToolkitValidationKey', () => {
  it('joins projectId and toolkitId with an underscore', () => {
    expect(buildToolkitValidationKey('proj-1', 'tk-1')).toBe('proj-1_tk-1');
  });

  it('stringifies undefined inputs (matches the baseline\'s `${projectId}_${toolkitId}` template literal)', () => {
    expect(buildToolkitValidationKey(undefined, undefined)).toBe('undefined_undefined');
  });
});

describe('useValidateToolkit', () => {
  it('does nothing when the injected query reports no error', () => {
    resetStore();
    const onError = vi.fn();
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({ isError: false, error: undefined });

    renderHook(() => useValidateToolkit({ projectId: 'proj-1', toolkitId: 'tk-1', useValidateToolkitQuery, onError }));

    expect(onError).not.toHaveBeenCalled();
    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-1']).toBeUndefined();
  });

  it('calls onError for a non-400 error and stores the combined validation info', () => {
    resetStore();
    const onError = vi.fn();
    const error = {
      status: 500,
      data: { settings_errors: [{ loc: ['token'], msg: 'Required' }] },
    };
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({ isError: true, error });

    renderHook(() => useValidateToolkit({ projectId: 'proj-1', toolkitId: 'tk-1', useValidateToolkitQuery, onError }));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-1']).toEqual([{ loc: ['token'], msg: 'Required' }]);
  });

  it('does NOT call onError for a 400 error, but still stores the validation info', () => {
    resetStore();
    const onError = vi.fn();
    const error = {
      status: 400,
      data: {
        connection_errors: [{ message: 'Cannot connect', configuration_title: 'My GitHub' }],
      },
    };
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({ isError: true, error });

    renderHook(() => useValidateToolkit({ projectId: 'proj-1', toolkitId: 'tk-1', useValidateToolkitQuery, onError }));

    expect(onError).not.toHaveBeenCalled();
    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-1']).toEqual([
      { type: 'connection_error', msg: 'Cannot connect', loc: ['My GitHub'] },
    ]);
  });

  it('stores an empty list when the error carries no recognisable body', () => {
    resetStore();
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({ isError: true, error: 'plain string error' });

    renderHook(() => useValidateToolkit({ projectId: 'proj-1', toolkitId: 'tk-2', useValidateToolkitQuery }));

    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-2']).toEqual([]);
  });

  it('re-runs when the injected query result changes across a rerender', () => {
    resetStore();
    let call = 0;
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => {
      call += 1;
      return call === 1
        ? { isError: false, error: undefined }
        : { isError: true, error: { status: 400, data: { settings_errors: [{ msg: 'now broken' }] } } };
    };

    const { rerender } = renderHook(() => useValidateToolkit({ projectId: 'proj-1', toolkitId: 'tk-3', useValidateToolkitQuery }));
    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-3']).toBeUndefined();

    act(() => rerender());
    expect(useToolkitValidationStore.getState().infoByKey['proj-1_tk-3']).toEqual([{ msg: 'now broken' }]);
  });
});

describe('useToolkitValidationInfo', () => {
  it('returns an empty list before any validation has run', () => {
    resetStore();
    const { result } = renderHook(() => useToolkitValidationInfo({ projectId: 'proj-9', toolkitId: 'tk-9' }));
    expect(result.current.toolkitValidationInfoList).toEqual([]);
  });

  it('returns [] (not undefined) when projectId or toolkitId is missing, even if the store has data under some other key', () => {
    resetStore();
    useToolkitValidationStore.getState().setToolkitValidationInfo('proj-1_tk-1', [{ msg: 'x' }]);
    const { result } = renderHook(() => useToolkitValidationInfo({ projectId: undefined, toolkitId: 'tk-1' }));
    expect(result.current.toolkitValidationInfoList).toEqual([]);
  });

  it('reflects validation info written by useValidateToolkit for the same project/toolkit key', () => {
    resetStore();
    const useValidateToolkitQuery: UseValidateToolkitQuery = () => ({
      isError: true,
      error: { status: 400, data: { settings_errors: [{ msg: 'bad config' }] } },
    });

    renderHook(() => useValidateToolkit({ projectId: 'proj-5', toolkitId: 'tk-5', useValidateToolkitQuery }));
    const { result } = renderHook(() => useToolkitValidationInfo({ projectId: 'proj-5', toolkitId: 'tk-5' }));

    expect(result.current.toolkitValidationInfoList).toEqual([{ msg: 'bad config' }]);
  });
});
