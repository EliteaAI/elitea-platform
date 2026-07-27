import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setAccessToken } from '../lib/storage';

import { useMcpTokenChange } from './useMcpTokenChange';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('useMcpTokenChange', () => {
  it('starts false when there is no stored token', () => {
    const { result } = renderHook(() => useMcpTokenChange('https://never-authed.example.com'));
    expect(result.current.isLoggedIn).toBe(false);
  });

  it('starts true when a token is already present at mount (accepts a bare string, legacy call shape)', () => {
    setAccessToken('https://already-authed.example.com', 'tok', 3600, undefined, undefined, undefined);
    const { result } = renderHook(() => useMcpTokenChange('https://already-authed.example.com'));
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('accepts the object form and resolves the same storage key', () => {
    setAccessToken(undefined, 'tok', 3600, undefined, undefined, undefined, {}, 'mcp_github');
    const { result } = renderHook(() => useMcpTokenChange({ toolkitType: 'mcp_github' }));
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('flips to true when setAccessToken dispatches a matching token-change event', () => {
    const { result } = renderHook(() => useMcpTokenChange('https://live-update.example.com'));
    expect(result.current.isLoggedIn).toBe(false);

    act(() => {
      setAccessToken('https://live-update.example.com', 'new-tok', 3600, undefined, undefined, undefined);
    });

    expect(result.current.isLoggedIn).toBe(true);
  });

  it('ignores a token-change event for a DIFFERENT server', () => {
    const { result } = renderHook(() => useMcpTokenChange('https://mine.example.com'));

    act(() => {
      setAccessToken('https://someone-elses.example.com', 'tok', 3600, undefined, undefined, undefined);
    });

    expect(result.current.isLoggedIn).toBe(false);
  });

  it('refreshLoginStatus() re-reads storage on demand', () => {
    const { result } = renderHook(() => useMcpTokenChange('https://manual-refresh.example.com'));
    expect(result.current.isLoggedIn).toBe(false);

    // Simulate an out-of-band write that does NOT dispatch the event (defensive: manual call still works).
    setAccessToken('https://manual-refresh.example.com', 'tok', 3600, undefined, undefined, undefined);
    act(() => {
      result.current.refreshLoginStatus();
    });
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('with neither serverUrl nor toolkitType, stays false and never throws', () => {
    const { result } = renderHook(() => useMcpTokenChange(undefined));
    expect(result.current.isLoggedIn).toBe(false);
    act(() => result.current.refreshLoginStatus());
    expect(result.current.isLoggedIn).toBe(false);
  });
});
