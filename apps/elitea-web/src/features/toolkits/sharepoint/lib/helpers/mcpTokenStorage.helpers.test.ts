import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MCP_TOKEN_CHANGE_EVENT,
  canonicalizeServerUrl,
  getAccessToken,
  getStorageKey,
  isPrebuildMcpType,
  logout,
  setConnectionVerified,
} from './mcpTokenStorage.helpers';

describe('isPrebuildMcpType', () => {
  it('returns true for an mcp_-prefixed type other than the bare "mcp"', () => {
    expect(isPrebuildMcpType('mcp_github')).toBe(true);
  });

  it('returns false for the bare "mcp" (remote MCP, not pre-built)', () => {
    expect(isPrebuildMcpType('mcp')).toBe(false);
  });

  it('returns false for "sharepoint" (SharePoint is never a pre-built MCP type)', () => {
    expect(isPrebuildMcpType('sharepoint')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPrebuildMcpType(undefined)).toBe(false);
  });
});

describe('canonicalizeServerUrl', () => {
  it('lower-cases scheme/host and drops a trailing slash on a bare origin', () => {
    expect(canonicalizeServerUrl('HTTPS://Login.Microsoftonline.com/')).toBe('https://login.microsoftonline.com');
  });

  it('preserves a non-trivial path', () => {
    expect(canonicalizeServerUrl('https://login.microsoftonline.com/tenant/oauth2/token')).toBe(
      'https://login.microsoftonline.com/tenant/oauth2/token',
    );
  });

  it('passes a credential-scoped composite key through unchanged', () => {
    expect(canonicalizeServerUrl('uuid-1:https://login.microsoftonline.com/tenant')).toBe(
      'uuid-1:https://login.microsoftonline.com/tenant',
    );
  });

  it('falls back to the raw input on an unparseable URL', () => {
    expect(canonicalizeServerUrl('not a url')).toBe('not a url');
  });
});

describe('getStorageKey', () => {
  it('prefers the pre-built toolkitType key', () => {
    expect(getStorageKey({ serverUrl: 'https://example.com', toolkitType: 'mcp_github' })).toBe('mcp_github');
  });

  it('returns a credential-scoped composite serverUrl as-is', () => {
    expect(getStorageKey({ serverUrl: 'uuid-1:https://login.microsoftonline.com/tenant' })).toBe(
      'uuid-1:https://login.microsoftonline.com/tenant',
    );
  });

  it('canonicalizes a plain serverUrl', () => {
    expect(getStorageKey({ serverUrl: 'HTTPS://Login.Microsoftonline.com/' })).toBe('https://login.microsoftonline.com');
  });

  it('returns null when neither serverUrl nor toolkitType is given', () => {
    expect(getStorageKey({})).toBeNull();
  });
});

describe('getAccessToken / logout / setConnectionVerified (sessionStorage round-trip)', () => {
  const serverUrl = 'uuid-1:https://login.microsoftonline.com/tenant';

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('getAccessToken returns null when nothing is stored', () => {
    expect(getAccessToken(serverUrl)).toBeNull();
  });

  it('setConnectionVerified stores a verified marker getAccessToken then reads back', () => {
    setConnectionVerified(serverUrl);
    expect(getAccessToken(serverUrl)).toBe('__connection_verified__');
  });

  it('setConnectionVerified does not overwrite an existing real token', () => {
    window.sessionStorage.setItem(
      'mcp_oauth_tokens',
      JSON.stringify({ [serverUrl]: { access_token: 'real-token', issued_at: Date.now(), expires_at: Date.now() + 60_000 } }),
    );
    setConnectionVerified(serverUrl);
    expect(getAccessToken(serverUrl)).toBe('real-token');
  });

  it('logout removes the stored token and getAccessToken reports null afterwards', () => {
    setConnectionVerified(serverUrl);
    expect(getAccessToken(serverUrl)).not.toBeNull();
    logout(serverUrl);
    expect(getAccessToken(serverUrl)).toBeNull();
  });

  it('getAccessToken returns null for an expired token', () => {
    window.sessionStorage.setItem(
      'mcp_oauth_tokens',
      JSON.stringify({ [serverUrl]: { access_token: 'stale', issued_at: 0, expires_at: 1 } }),
    );
    expect(getAccessToken(serverUrl)).toBeNull();
  });

  it('setConnectionVerified dispatches MCP_TOKEN_CHANGE_EVENT with the resolved key and "login" type', () => {
    const listener = vi.fn();
    window.addEventListener(MCP_TOKEN_CHANGE_EVENT, listener);
    setConnectionVerified(serverUrl);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<{ serverUrl: string; type: string }>;
    expect(event.detail).toEqual({ serverUrl, type: 'login' });
    window.removeEventListener(MCP_TOKEN_CHANGE_EVENT, listener);
  });

  it('logout dispatches MCP_TOKEN_CHANGE_EVENT with "logout" type only when a token existed', () => {
    const listener = vi.fn();
    window.addEventListener(MCP_TOKEN_CHANGE_EVENT, listener);
    logout(serverUrl);
    expect(listener).not.toHaveBeenCalled();
    setConnectionVerified(serverUrl);
    logout(serverUrl);
    expect(listener).toHaveBeenCalledTimes(2);
    const secondCall = listener.mock.calls[1];
    if (secondCall === undefined) throw new Error('expected a second call');
    const secondEvent = secondCall[0] as CustomEvent<{ type: string }>;
    expect(secondEvent.detail.type).toBe('logout');
    window.removeEventListener(MCP_TOKEN_CHANGE_EVENT, listener);
  });
});
