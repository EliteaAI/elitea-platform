import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useFileDragAndDrop } from './useFileDragAndDrop.hooks';

function dragEvent(relatedTarget: Node | null = null, currentTarget: { contains: (n: Node | null) => boolean } = { contains: () => false }): DragEvent<HTMLDivElement> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    relatedTarget,
    currentTarget,
  } as unknown as DragEvent<HTMLDivElement>;
}

describe('useFileDragAndDrop', () => {
  it('sets isDragOver on dragover and clears it on drop', () => {
    const { result } = renderHook(() => useFileDragAndDrop());
    expect(result.current.isDragOver).toBe(false);

    act(() => result.current.handleDragOver(dragEvent()));
    expect(result.current.isDragOver).toBe(true);

    act(() => result.current.handleDrop(dragEvent()));
    expect(result.current.isDragOver).toBe(false);
  });

  it('clears isDragOver on dragleave only when leaving the container entirely', () => {
    const { result } = renderHook(() => useFileDragAndDrop());
    act(() => result.current.handleDragOver(dragEvent()));

    act(() => result.current.handleDragLeave(dragEvent(document.createElement('span'), { contains: () => true })));
    expect(result.current.isDragOver).toBe(true);

    act(() => result.current.handleDragLeave(dragEvent(document.createElement('span'), { contains: () => false })));
    expect(result.current.isDragOver).toBe(false);
  });

  it('forwards the drop event to the caller-supplied handler', () => {
    const onDropHandler = vi.fn();
    const { result } = renderHook(() => useFileDragAndDrop(onDropHandler));
    const event = dragEvent();
    act(() => result.current.handleDrop(event));
    expect(onDropHandler).toHaveBeenCalledWith(event);
  });
});
