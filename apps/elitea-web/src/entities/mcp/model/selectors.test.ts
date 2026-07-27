import { describe, expect, it } from 'vitest';

import { isMcpConnected, isMcpTokenExpired, needsProactiveRefresh } from './selectors';
import type { McpTokenInfo } from './types';

const token = (overrides: Partial<McpTokenInfo> = {}): McpTokenInfo => ({
  accessToken: 'tok',
  issuedAt: 0,
  expiresAt: 1000,
  tokenEndpoint: 'https://example.com/token',
  clientId: 'client',
  projectId: 'p1',
  toolkitId: 't1',
  toolkitType: 'mcp',
  ...overrides,
});

describe('isMcpTokenExpired', () => {
  it('is false before expiry', () => {
    expect(isMcpTokenExpired(token({ expiresAt: 1000 }), 500)).toBe(false);
  });

  it('is true at exactly expiresAt', () => {
    expect(isMcpTokenExpired(token({ expiresAt: 1000 }), 1000)).toBe(true);
  });

  it('is true after expiry', () => {
    expect(isMcpTokenExpired(token({ expiresAt: 1000 }), 1500)).toBe(true);
  });
});

describe('needsProactiveRefresh', () => {
  it('is false below the 75% threshold', () => {
    expect(needsProactiveRefresh(token({ issuedAt: 0, expiresAt: 1000 }), 700)).toBe(false);
  });

  it('is true at exactly the 75% threshold', () => {
    expect(needsProactiveRefresh(token({ issuedAt: 0, expiresAt: 1000 }), 750)).toBe(true);
  });

  it('is true past the threshold', () => {
    expect(needsProactiveRefresh(token({ issuedAt: 0, expiresAt: 1000 }), 900)).toBe(true);
  });

  it('treats a non-positive lifetime as needing refresh', () => {
    expect(needsProactiveRefresh(token({ issuedAt: 1000, expiresAt: 1000 }), 1000)).toBe(true);
  });
});

describe('isMcpConnected', () => {
  it('is true when the server reports online, regardless of token', () => {
    expect(isMcpConnected(true, undefined, 0)).toBe(true);
  });

  it('is true when offline but a live token exists', () => {
    expect(isMcpConnected(false, token({ expiresAt: 1000 }), 500)).toBe(true);
  });

  it('is false when offline and the token is expired', () => {
    expect(isMcpConnected(false, token({ expiresAt: 1000 }), 1500)).toBe(false);
  });

  it('is false when offline and there is no token', () => {
    expect(isMcpConnected(false, undefined, 0)).toBe(false);
  });

  it('is false when online is undefined and there is no token', () => {
    expect(isMcpConnected(undefined, undefined, 0)).toBe(false);
  });
});
