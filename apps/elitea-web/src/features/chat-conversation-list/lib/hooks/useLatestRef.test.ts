import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLatestRef } from './useLatestRef';

describe('useLatestRef', () => {
  it('returns a ref whose .current is the value passed on the latest render', () => {
    const { result, rerender } = renderHook(({ value }: { value: number }) => useLatestRef(value), { initialProps: { value: 1 } });

    expect(result.current.current).toBe(1);

    rerender({ value: 2 });
    expect(result.current.current).toBe(2);
  });

  it('preserves the same ref object identity across renders', () => {
    const { result, rerender } = renderHook(({ value }: { value: number }) => useLatestRef(value), { initialProps: { value: 1 } });

    const firstRef = result.current;
    rerender({ value: 2 });

    expect(result.current).toBe(firstRef);
  });
});
