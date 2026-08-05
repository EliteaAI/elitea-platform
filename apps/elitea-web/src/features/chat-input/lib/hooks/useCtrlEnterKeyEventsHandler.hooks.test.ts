import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCtrlEnterKeyEventsHandler } from './useCtrlEnterKeyEventsHandler.hooks';

function keyEvent(overrides: Partial<KeyboardEvent<HTMLDivElement>>): KeyboardEvent<HTMLDivElement> {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    defaultPrevented: false,
    ...overrides,
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

describe('useCtrlEnterKeyEventsHandler', () => {
  it('calls onEnterDown on a plain Enter and prevents default', () => {
    const onEnterDown = vi.fn();
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onEnterDown }));
    const event = keyEvent({ key: 'Enter', preventDefault });
    result.current.onKeyDown(event);
    expect(onEnterDown).toHaveBeenCalledWith(event);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('calls onCtrlEnterDown on Ctrl+Enter, not onEnterDown', () => {
    const onEnterDown = vi.fn();
    const onCtrlEnterDown = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onEnterDown, onCtrlEnterDown }));
    result.current.onKeyDown(keyEvent({ key: 'Enter', ctrlKey: true }));
    expect(onCtrlEnterDown).toHaveBeenCalled();
    expect(onEnterDown).not.toHaveBeenCalled();
  });

  it('calls onShiftEnterPressed on Shift+Enter', () => {
    const onShiftEnterPressed = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onShiftEnterPressed }));
    result.current.onKeyDown(keyEvent({ key: 'Enter', shiftKey: true }));
    expect(onShiftEnterPressed).toHaveBeenCalled();
  });

  it('calls onNormalKeyDown for a non-modifier key before dispatching Enter, and stops if it prevents default', () => {
    const onNormalKeyDown = vi.fn((event: KeyboardEvent<HTMLDivElement>) => {
      Object.assign(event, { defaultPrevented: true });
    });
    const onEnterDown = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onNormalKeyDown, onEnterDown }));
    result.current.onKeyDown(keyEvent({ key: 'Enter' }));
    expect(onNormalKeyDown).toHaveBeenCalled();
    expect(onEnterDown).not.toHaveBeenCalled();
  });

  it('does not call onNormalKeyDown for bare modifier keys', () => {
    const onNormalKeyDown = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onNormalKeyDown }));
    result.current.onKeyDown(keyEvent({ key: 'Shift' }));
    expect(onNormalKeyDown).not.toHaveBeenCalled();
  });

  it('suppresses all dispatch while composing (IME)', () => {
    const onEnterDown = vi.fn();
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({ onEnterDown }));
    act(() => result.current.onCompositionStart({} as never));
    result.current.onKeyDown(keyEvent({ key: 'Enter' }));
    expect(onEnterDown).not.toHaveBeenCalled();
    act(() => result.current.onCompositionEnd({} as never));
    result.current.onKeyDown(keyEvent({ key: 'Enter' }));
    expect(onEnterDown).toHaveBeenCalled();
  });

  it('onKeyUp is a documented no-op', () => {
    const { result } = renderHook(() => useCtrlEnterKeyEventsHandler({}));
    expect(() => result.current.onKeyUp(keyEvent({ key: 'a' }))).not.toThrow();
  });
});
