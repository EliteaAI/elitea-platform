import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { createStorage } from '@/shared/lib/storage';

import { createAuthorizationMonitor, navigateAuthPopup, openAuthPopup } from './window';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('openAuthPopup', () => {
  it('opens a sized about:blank popup and writes a placeholder message into it', () => {
    const fakeDoc = { body: { style: {} as CSSStyleDeclaration, appendChild: vi.fn() }, createElement: vi.fn(() => ({ style: {} }) as unknown as HTMLElement) };
    const fakePopup = { document: fakeDoc } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakePopup);

    const result = openAuthPopup();

    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank', 'width=500,height=700');
    expect(result).toBe(fakePopup);
    expect(fakeDoc.createElement).toHaveBeenCalledTimes(2); // h2 + p
  });

  it('returns null when the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openAuthPopup()).toBeNull();
  });
});

describe('navigateAuthPopup', () => {
  it('sets location.href on an open window', () => {
    const fakeWindow = { closed: false, location: { href: '' } } as unknown as Window;
    navigateAuthPopup(fakeWindow, 'https://auth.example.com/authorize?x=1');
    expect((fakeWindow as unknown as { location: { href: string } }).location.href).toBe(
      'https://auth.example.com/authorize?x=1',
    );
  });

  it('throws if the popup was closed by the user before navigation', () => {
    const fakeWindow = { closed: true, location: { href: '' } } as unknown as Window;
    expect(() => navigateAuthPopup(fakeWindow, 'https://auth.example.com')).toThrow('Authorization window was closed');
  });
});

describe('createAuthorizationMonitor', () => {
  it('resolves via postMessage carrying a same-origin, matching-state code', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-abc', onSuccess, onError);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcp-auth-result', state: 'state-abc', success: true, code: 'auth-code-1' },
      }),
    );

    expect(onSuccess).toHaveBeenCalledWith({ code: 'auth-code-1' });
    expect(onError).not.toHaveBeenCalled();
    cleanup();
  });

  it('ignores a postMessage from a different origin', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-xyz', onSuccess, onError);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: { type: 'mcp-auth-result', state: 'state-xyz', code: 'stolen' },
      }),
    );

    expect(onSuccess).not.toHaveBeenCalled();
    cleanup();
  });

  it('ignores a postMessage whose state does not match', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'expected-state', onSuccess, onError);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcp-auth-result', state: 'wrong-state', code: 'auth-code' },
      }),
    );

    expect(onSuccess).not.toHaveBeenCalled();
    cleanup();
  });

  it('surfaces an OAuth error payload via onError', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-err', onSuccess, onError);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcp-auth-result', state: 'state-err', error: 'access_denied', error_description: 'User declined' },
      }),
    );

    expect(onError).toHaveBeenCalledWith(new Error('User declined'));
    cleanup();
  });

  it('errors when the result carries neither a code nor an error', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-empty', onSuccess, onError);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcp-auth-result', state: 'state-empty' },
      }),
    );

    expect(onError).toHaveBeenCalledWith(new Error('No authorization result received'));
    cleanup();
  });

  it('picks up a result already written to storage before the listener attached (race with a fast callback)', async () => {
    vi.useFakeTimers();
    createStorage('local').setJSON('mcp-auth-result-state-race', {
      type: 'mcp-auth-result',
      state: 'state-race',
      code: 'already-there',
    });

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-race', onSuccess, onError);

    await vi.advanceTimersByTimeAsync(0);

    expect(onSuccess).toHaveBeenCalledWith({ code: 'already-there' });
    cleanup();
  });

  it('times out after 5 minutes with no result', () => {
    vi.useFakeTimers();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    createAuthorizationMonitor(null, 'state-timeout', onSuccess, onError);

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(onError).toHaveBeenCalledWith(new Error('Authorization timed out. Please try again.'));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('cleanup() prevents a late message from resolving twice', () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const cleanup = createAuthorizationMonitor(null, 'state-cleanup', onSuccess, onError);
    cleanup();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcp-auth-result', state: 'state-cleanup', code: 'too-late' },
      }),
    );

    expect(onSuccess).not.toHaveBeenCalled();
  });
});
