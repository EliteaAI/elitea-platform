import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debounce } from './function';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes fn once after the delay, coalescing rapid calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forwards arguments to fn', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced(1, 'a');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith(1, 'a');
  });

  it('restarts the timer on each call within the delay window', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(60);
    debounced();
    vi.advanceTimersByTime(60);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invokes again for a call made after the previous debounced call fired', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 10);
    debounced();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('forwards call-time `this` (parity: function expression + .apply)', () => {
    const spy = vi.fn();
    const obj = { method: debounce(spy, 10) };
    obj.method();
    vi.advanceTimersByTime(10);
    expect(spy.mock.contexts[0]).toBe(obj);
  });
});
