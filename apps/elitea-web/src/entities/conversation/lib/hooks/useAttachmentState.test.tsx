import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAttachmentState } from './useAttachmentState';

describe('useAttachmentState', () => {
  it('starts empty by default', () => {
    const { result } = renderHook(() => useAttachmentState<string>());
    expect(result.current.attachments).toEqual([]);
  });

  it('starts with the given initial attachments', () => {
    const { result } = renderHook(() => useAttachmentState(['a']));
    expect(result.current.attachments).toEqual(['a']);
  });

  it('onAttachFiles appends', () => {
    const { result } = renderHook(() => useAttachmentState<string>());
    act(() => result.current.onAttachFiles(['a', 'b']));
    expect(result.current.attachments).toEqual(['a', 'b']);
  });

  it('onDeleteAttachment removes by index', () => {
    const { result } = renderHook(() => useAttachmentState(['a', 'b', 'c']));
    act(() => result.current.onDeleteAttachment(1));
    expect(result.current.attachments).toEqual(['a', 'c']);
  });

  it('onClearAttachments empties the list', () => {
    const { result } = renderHook(() => useAttachmentState(['a']));
    act(() => result.current.onClearAttachments());
    expect(result.current.attachments).toEqual([]);
  });

  it('replaceAttachments swaps the whole list', () => {
    const { result } = renderHook(() => useAttachmentState(['a']));
    act(() => result.current.replaceAttachments(['x', 'y']));
    expect(result.current.attachments).toEqual(['x', 'y']);
  });
});
