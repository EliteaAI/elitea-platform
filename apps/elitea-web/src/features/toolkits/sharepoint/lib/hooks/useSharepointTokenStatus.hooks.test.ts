import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setConnectionVerified } from '../helpers/mcpTokenStorage.helpers';
import { useSharepointTokenStatus } from './useSharepointTokenStatus.hooks';

describe('useSharepointTokenStatus', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('reports isLoggedIn=false when there is no serverUrl', () => {
    const { result } = renderHook(() => useSharepointTokenStatus(undefined));
    expect(result.current.isLoggedIn).toBe(false);
  });

  it('reports isLoggedIn=false when no token is stored for the given serverUrl', () => {
    const { result } = renderHook(() => useSharepointTokenStatus('https://contoso.sharepoint.com'));
    expect(result.current.isLoggedIn).toBe(false);
  });

  it('reports isLoggedIn=true on mount when a valid token already exists', () => {
    setConnectionVerified('https://contoso.sharepoint.com');
    const { result } = renderHook(() => useSharepointTokenStatus('https://contoso.sharepoint.com'));
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('flips to isLoggedIn=true when the matching token-change event fires', () => {
    const { result } = renderHook(() => useSharepointTokenStatus('https://contoso.sharepoint.com'));
    expect(result.current.isLoggedIn).toBe(false);

    act(() => {
      setConnectionVerified('https://contoso.sharepoint.com');
    });

    expect(result.current.isLoggedIn).toBe(true);
  });

  it('ignores a token-change event for a different serverUrl', () => {
    const { result } = renderHook(() => useSharepointTokenStatus('https://contoso.sharepoint.com'));

    act(() => {
      setConnectionVerified('https://fabrikam.sharepoint.com');
    });

    expect(result.current.isLoggedIn).toBe(false);
  });

  it('refreshLoginStatus re-reads storage on demand', () => {
    const { result } = renderHook(() => useSharepointTokenStatus('https://contoso.sharepoint.com'));
    expect(result.current.isLoggedIn).toBe(false);

    setConnectionVerified('https://contoso.sharepoint.com');
    act(() => {
      result.current.refreshLoginStatus();
    });

    expect(result.current.isLoggedIn).toBe(true);
  });
});
