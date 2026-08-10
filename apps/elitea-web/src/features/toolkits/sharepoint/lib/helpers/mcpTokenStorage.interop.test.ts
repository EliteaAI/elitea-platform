/**
 * Cross-slice interop: SharePoint READS the token record that `features/mcps`
 * WRITES.
 *
 * `no-sideways-features` forbids `features/toolkits` importing
 * `features/mcps`, so this module hand-copies three constants (storage key,
 * change-event name, verified sentinel) from `features/mcps/lib/constants.ts`.
 * A hand-copied constant is exactly the kind of thing that drifts silently —
 * and it HAD drifted: this module read the baseline's raw
 * `sessionStorage['mcp_oauth_tokens']` while the real writer had long since
 * moved to the namespaced `el.mcp.tokens`. Nothing failed. A SharePoint OAuth
 * login simply never showed as connected.
 *
 * This test pins the two sides together through their REAL implementations —
 * `features/mcps`' own writer, this module's reader — so any future change to
 * either name fails here instead of silently disconnecting the feature. The
 * import below is the one place in the repo where the two slices meet, and it
 * is a TEST file (dependency-cruiser excludes `*.test.*` from the layer gate,
 * see `.dependency-cruiser.cjs`'s `options.exclude`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { logout as mcpLogout, setAccessToken } from '@/features/mcps/lib/storage';

import { MCP_TOKEN_CHANGE_EVENT, getAccessToken } from './mcpTokenStorage.helpers';

/** The composite `"{configUuid}:{oauthEndpoint}"` key SharePoint credentials use (`token.helpers.ts`). */
const SHAREPOINT_TOKEN_KEY = 'cfg-uuid-1:https://login.microsoftonline.com/tenant';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('SharePoint token reader ↔ features/mcps token writer', () => {
  it('reads back a token written by the real features/mcps writer (the OAuth modal path)', () => {
    setAccessToken(SHAREPOINT_TOKEN_KEY, 'sp-oauth-token', 3600, null, null, null);

    expect(getAccessToken(SHAREPOINT_TOKEN_KEY)).toBe('sp-oauth-token');
  });

  it('reports null again once features/mcps removes the token', () => {
    setAccessToken(SHAREPOINT_TOKEN_KEY, 'sp-oauth-token', 3600, null, null, null);
    mcpLogout(SHAREPOINT_TOKEN_KEY);

    expect(getAccessToken(SHAREPOINT_TOKEN_KEY)).toBeNull();
  });

  it('agrees with features/mcps on the token-change event name, so useSharepointTokenStatus actually wakes up', () => {
    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push((event as CustomEvent<{ readonly serverUrl?: string }>).detail?.serverUrl ?? '');
    };
    window.addEventListener(MCP_TOKEN_CHANGE_EVENT, listener);

    setAccessToken(SHAREPOINT_TOKEN_KEY, 'sp-oauth-token', 3600, null, null, null);

    window.removeEventListener(MCP_TOKEN_CHANGE_EVENT, listener);
    expect(seen).toContain(SHAREPOINT_TOKEN_KEY);
  });
});
