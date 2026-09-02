import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDrawerResize, widthForPointer } from './useDrawerResize';

describe('widthForPointer', () => {
  it('measures from the RIGHT edge, because the drawer is anchored there', () => {
    // Dragging LEFT (a smaller clientX) makes the drawer wider. The opposite
    // sign is the bug this test exists for: it shrinks as it is dragged open.
    expect(widthForPointer(1000, 1400, 100, 900)).toBe(400);
    expect(widthForPointer(800, 1400, 100, 900)).toBe(600);
  });

  it('clamps to both bounds', () => {
    expect(widthForPointer(1399, 1400, 350, 800)).toBe(350);
    expect(widthForPointer(100, 1400, 350, 800)).toBe(800);
  });

  it('never returns a negative width when the pointer leaves the window', () => {
    expect(widthForPointer(1600, 1400, 350, 800)).toBe(350);
  });
});

describe('useDrawerResize', () => {
  const options = { initialWidth: 480, minWidth: 350, maxWidth: 800, viewportWidth: () => 1400 };

  it('does not follow the pointer until a drag has started', () => {
    const { result } = renderHook(() => useDrawerResize(options));
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }));
    });
    expect(result.current.width).toBe(480);
  });

  it('follows the pointer while dragging and stops on mouseup', () => {
    const { result } = renderHook(() => useDrawerResize(options));

    act(() => {
      result.current.startResize();
    });
    expect(result.current.isResizing).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }));
    });
    expect(result.current.width).toBe(600);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(result.current.isResizing).toBe(false);

    // The release must actually detach the listener. A drag that never ends is
    // a drawer that resizes on every later mouse move anywhere on the page.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    });
    expect(result.current.width).toBe(600);
  });

  it('nudges by the keyboard step, clamped at both ends', () => {
    const { result } = renderHook(() => useDrawerResize(options));

    act(() => {
      result.current.nudge(24);
    });
    expect(result.current.width).toBe(504);

    // Clamped, not wrapped: holding the key at the edge must not jump the
    // drawer to the other bound.
    act(() => {
      result.current.nudge(10_000);
    });
    expect(result.current.width).toBe(800);
    act(() => {
      result.current.nudge(-10_000);
    });
    expect(result.current.width).toBe(350);
  });

  it('removes its listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useDrawerResize(options));
    act(() => {
      result.current.startResize();
    });
    unmount();
    // No assertion is possible on a detached hook; what this proves is that
    // dispatching after unmount does not throw a React state-update warning
    // into the console, which the suite treats as a failure.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }));
  });
});
