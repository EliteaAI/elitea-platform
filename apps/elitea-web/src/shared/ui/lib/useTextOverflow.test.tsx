import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTextOverflow } from './useTextOverflow';

/**
 * jsdom does not implement `ResizeObserver`. A minimal stub is enough here:
 * the hook only calls `.observe()`/`.disconnect()`, never reads anything
 * back from the observer — the resize-triggered re-check path is exercised
 * by invoking the stub's stored callback directly.
 */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

function setBoxSize(element: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
}

/** A component-shaped wrapper: attaches `element` as the hook's ref target on every render. */
function useAttached(text: string, element: HTMLElement) {
  const hook = useTextOverflow(text);
  hook.textRef.current = element;
  return hook;
}

describe('useTextOverflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts as not overflowing, before the ref is attached to an element', () => {
    const { result } = renderHook(() => useTextOverflow('hello'));
    expect(result.current.isOverflowing).toBe(false);
    expect(result.current.textRef.current).toBeNull();
  });

  it('does nothing (no ResizeObserver created) when the ref never attaches', () => {
    renderHook(() => useTextOverflow('hello'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ResizeObserverStub.instances).toHaveLength(0);
  });

  it('reports overflow once scrollWidth exceeds clientWidth, after the debounce delay', () => {
    const element = document.createElement('span');
    setBoxSize(element, 200, 100);

    const { result } = renderHook(() => useAttached('hello', element));
    expect(result.current.isOverflowing).toBe(false); // not yet checked

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isOverflowing).toBe(true);
  });

  it('reports not overflowing when scrollWidth fits within clientWidth', () => {
    const element = document.createElement('span');
    setBoxSize(element, 50, 100);

    const { result } = renderHook(() => useAttached('hello', element));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isOverflowing).toBe(false);
  });

  it('observes the attached element via ResizeObserver', () => {
    const element = document.createElement('span');
    setBoxSize(element, 50, 100);

    renderHook(() => useAttached('hello', element));
    expect(ResizeObserverStub.instances).toHaveLength(1);
    expect(ResizeObserverStub.instances[0]?.observed).toContain(element);
  });

  it('recomputes when the ResizeObserver callback fires', () => {
    const element = document.createElement('span');
    setBoxSize(element, 50, 100);

    const { result } = renderHook(() => useAttached('hello', element));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isOverflowing).toBe(false);

    setBoxSize(element, 300, 100);
    const observer = ResizeObserverStub.instances[0];
    act(() => {
      observer?.callback([], observer as unknown as ResizeObserver);
      vi.advanceTimersByTime(10);
    });
    expect(result.current.isOverflowing).toBe(true);
  });

  it('disconnects the observer and clears pending timeouts on unmount', () => {
    const element = document.createElement('span');
    setBoxSize(element, 200, 100);

    const { unmount } = renderHook(() => useAttached('hello', element));
    const observer = ResizeObserverStub.instances[0];
    expect(observer?.disconnected).toBe(false);

    unmount();
    expect(observer?.disconnected).toBe(true);

    // The pending 50ms/200ms checks were cleared by the cleanup above; if
    // they had fired anyway they would throw (no error-swallowing in the
    // hook), so simply advancing time past their delays without an
    // unhandled exception is the proof.
    vi.advanceTimersByTime(300);
  });

  it('re-observes when the text argument changes (new effect run)', () => {
    const element = document.createElement('span');
    setBoxSize(element, 50, 100);

    const { rerender } = renderHook(({ text }) => useAttached(text, element), {
      initialProps: { text: 'a' },
    });
    expect(ResizeObserverStub.instances).toHaveLength(1);

    rerender({ text: 'b' });
    expect(ResizeObserverStub.instances).toHaveLength(2);
    expect(ResizeObserverStub.instances[0]?.disconnected).toBe(true);
  });
});
