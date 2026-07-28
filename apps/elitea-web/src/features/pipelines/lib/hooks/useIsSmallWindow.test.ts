import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsSmallWindow } from './useIsSmallWindow';

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

afterEach(() => {
  setWindowWidth(1280);
});

describe('useIsSmallWindow', () => {
  it('reports false when the window is wide', () => {
    setWindowWidth(1280);
    const { result } = renderHook(() => useIsSmallWindow());
    expect(result.current.isSmallWindow).toBe(false);
  });

  it('reports true when the window is narrower than MIN_LARGE_WINDOW_WIDTH', () => {
    setWindowWidth(800);
    const { result } = renderHook(() => useIsSmallWindow());
    expect(result.current.isSmallWindow).toBe(true);
  });

  it('flips to true and calls the callback on a resize below the threshold', () => {
    setWindowWidth(1280);
    const onResize = vi.fn();
    const { result } = renderHook(() => useIsSmallWindow(onResize));
    expect(result.current.isSmallWindow).toBe(false);

    act(() => {
      setWindowWidth(800);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.isSmallWindow).toBe(true);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('flips back to false and calls the callback on a resize above the threshold', () => {
    // Mounting narrow itself fires the callback once (mount's own `onSize()`
    // corrects the `useState(false)` default against the real width) —
    // isolate just the resize-triggered call by clearing after mount.
    setWindowWidth(800);
    const onResize = vi.fn();
    const { result } = renderHook(() => useIsSmallWindow(onResize));
    expect(result.current.isSmallWindow).toBe(true);
    onResize.mockClear();

    act(() => {
      setWindowWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.isSmallWindow).toBe(false);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('does not call the callback when the resize does not cross the threshold', () => {
    setWindowWidth(1280);
    const onResize = vi.fn();
    renderHook(() => useIsSmallWindow(onResize));

    act(() => {
      setWindowWidth(1400);
      window.dispatchEvent(new Event('resize'));
    });

    expect(onResize).not.toHaveBeenCalled();
  });

  it('removes the resize listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIsSmallWindow());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
