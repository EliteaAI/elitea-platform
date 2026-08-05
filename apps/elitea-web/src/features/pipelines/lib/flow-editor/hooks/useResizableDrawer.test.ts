import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useResizableDrawer } from './useResizableDrawer';

function attachContainer(el: HTMLDivElement) {
  document.body.appendChild(el);
  return () => document.body.removeChild(el);
}

describe('useResizableDrawer', () => {
  it('defaults to MIN_DRAWER_WIDTH and is not resizing', () => {
    const { result } = renderHook(() => useResizableDrawer());
    expect(result.current.drawerWidth).toBe(310);
    expect(result.current.isResizing).toBe(false);
  });

  it('honours a custom initialWidth', () => {
    const { result } = renderHook(() => useResizableDrawer(310, 800, 450));
    expect(result.current.drawerWidth).toBe(450);
  });

  it('handleResizeStart flips isResizing to true', () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => {
      result.current.handleResizeStart({ preventDefault: () => {}, clientX: 500 } as unknown as React.MouseEvent);
    });
    expect(result.current.isResizing).toBe(true);
  });

  it('dragging left (deltaX > 0) widens the drawer, clamped to maxWidth', async () => {
    const container = document.createElement('div');
    const cleanup = attachContainer(container);
    const { result } = renderHook(() => useResizableDrawer(310, 800, 400));
    result.current.containerRef.current = container;

    act(() => {
      result.current.handleResizeStart({ preventDefault: () => {}, clientX: 500 } as unknown as React.MouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 })); // deltaX = 500 - 100 = 400 -> 400+400=800, clamped to 800
    });

    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve));
    });

    expect(result.current.drawerWidth).toBe(800);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(result.current.isResizing).toBe(false);

    cleanup();
  });

  it('setIsHoveringHandle toggles isHoveringHandle', () => {
    const { result } = renderHook(() => useResizableDrawer());
    act(() => {
      result.current.setIsHoveringHandle(true);
    });
    expect(result.current.isHoveringHandle).toBe(true);
  });
});
