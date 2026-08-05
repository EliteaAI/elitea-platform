import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePipelineEditorStore } from '../../../model/pipelineEditorStore';
import { useStateValidation } from './useStateValidation';

beforeEach(() => {
  usePipelineEditorStore.getState().clearStateValidationErrors();
});

describe('useStateValidation', () => {
  it('validates every non-default state variable on mount', () => {
    renderHook(() => useStateValidation({ count: { type: 'number', value: 'not-a-number' } }));
    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({ count: 'Invalid number format' });
  });

  it('skips default props (input/messages) even when present', () => {
    renderHook(() => useStateValidation({ input: { type: 'str', value: '' }, messages: { type: 'list', value: [] } }));
    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({});
  });

  it('clears all errors when states is undefined', () => {
    usePipelineEditorStore.getState().setStateValidationError('stale', 'old error');
    renderHook(() => useStateValidation(undefined));
    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({});
  });

  it('validateVariable imperatively re-validates and writes to the store', () => {
    const { result } = renderHook(() => useStateValidation({}));

    act(() => {
      const error = result.current.validateVariable('items', 'list', 'not-json');
      expect(error).toBe('Invalid list format. Use JSON array: [1, 2] or ["item1", "item2"]');
    });

    expect(usePipelineEditorStore.getState().stateValidationErrors['items']).toBe(
      'Invalid list format. Use JSON array: [1, 2] or ["item1", "item2"]',
    );
  });

  it('clearValidationError removes just one entry', () => {
    usePipelineEditorStore.getState().setStateValidationError('a', 'err-a');
    usePipelineEditorStore.getState().setStateValidationError('b', 'err-b');
    const { result } = renderHook(() => useStateValidation({}));

    act(() => {
      result.current.clearValidationError('a');
    });

    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({ b: 'err-b' });
  });

  it('clearAllValidationErrors wipes everything', () => {
    usePipelineEditorStore.getState().setStateValidationError('a', 'err-a');
    const { result } = renderHook(() => useStateValidation({}));

    act(() => {
      result.current.clearAllValidationErrors();
    });

    expect(usePipelineEditorStore.getState().stateValidationErrors).toEqual({});
  });
});
