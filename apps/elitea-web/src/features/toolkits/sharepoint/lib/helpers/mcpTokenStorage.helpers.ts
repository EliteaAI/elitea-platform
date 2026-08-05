/**
 * `mcpTokenStorage.helpers.ts` — a DISCLOSED, INTENTIONALLY PARTIAL local
 * duplicate of `apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/
 * mcpAuth.helpers.js`'s sessionStorage-backed OAuth-token primitives, ported
 * only as far as SharePoint's own two consumers
 * (`SharepointDelegatedLoginButton.jsx`/`SharepointOAuthStatus.jsx`) ever
 * call: `getAccessToken`, `logout`, `setConnectionVerified`, and the
 * `getStorageKey`/`canonicalizeServerUrl` key-resolution helpers underneath
 * them.
 *
 * WHY A LOCAL DUPLICATE, NOT AN IMPORT: `features/mcps` (this app's real,
 * fully-built port of `features/mcp` — see its own `src/features/mcps/
 * index.ts`) already implements this exact storage layer
 * (`src/features/mcps/lib/storage.ts`) plus the full OAuth PKCE/discovery
 * flow around it. `no-sideways-features` (`.dependency-cruiser.cjs`)
 * forbids `features/toolkits` importing `features/mcps` outright — "no
 * carve-out" per this batch's own mission brief. Sharepoint folds INTO
 * `features/toolkits` (this file's own directory), so it inherits that
 * same restriction.
 *
 * WHY THIS SPECIFIC SUBSET COUNTS AS "THIN" (the mission brief's own
 * bar — "duplicate the thin pieces you need, disclose the rest"): every
 * function below is a PURE `sessionStorage` read/write with no network
 * request, no popup window, no PKCE/crypto, no discovery-metadata fetch —
 * unlike `mcpAuthWindow.helpers.js`/`mcpDiscovery.helpers.js`/
 * `mcpCrypto.helpers.js`/`mcpClientFactory.helpers.js` (the OAuth FLOW
 * itself), which stay `features/mcps`-owned and are NOT duplicated here.
 * The refresh-queue/scheduler/ignored-servers machinery in the baseline
 * file is ALSO not ported: grepped, neither `SharepointDelegatedLoginButton`
 * nor `SharepointOAuthStatus` ever calls `markRefreshPending`/
 * `getServersNeedingRefresh`/`addIgnoredServer`/`startTokenRefreshScheduler`
 * or any of that family — only token presence (`getAccessToken`), removal
 * (`logout`), and the "verified without a real OAuth token" marker
 * (`setConnectionVerified`, used for the non-delegated/header-auth case in
 * `SharepointOAuthStatus.tsx`).
 *
 * Ported byte-for-byte from `mcpAuth.helpers.js` for the functions kept
 * (same `sessionStorage` key names, same composite-key detection, same
 * `MCP_CONNECTION_VERIFIED` sentinel and 24h expiry) — this is a narrower
 * SLICE of that file, not a redesign of the logic it does contain.
 */

/** `mcAuth.constants.js`'s `MC_TOKENS_STORAGE_KEY`. */
const MC_TOKENS_STORAGE_KEY = 'mcp_oauth_tokens';
/** `mcAuth.constants.js`'s `MCP_TOKEN_CHANGE_EVENT`. */
export const MCP_TOKEN_CHANGE_EVENT = 'mcp-token-change';
/** `mcAuth.constants.js`'s `MCP_CONNECTION_VERIFIED` sentinel access-token value. */
const MCP_CONNECTION_VERIFIED = '__connection_verified__';
/** `mcAuth.constants.js`'s `MCP_PREBUILD_PREFIX` — checked so `getStorageKey` matches the baseline's precedence order, even though SharePoint's own `type` ('sharepoint') is never prebuild-prefixed. */
const MCP_PREBUILD_PREFIX = 'mcp_';

interface StoredToken {
  readonly access_token?: string;
  readonly issued_at?: number;
  readonly expires_at?: number | null;
  readonly connection_verified?: boolean;
  readonly toolkit_type?: string;
  readonly [key: string]: unknown;
}

type TokenStore = Record<string, StoredToken>;

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && window.sessionStorage !== undefined;
}

function safeParse(value: string | null): TokenStore {
  try {
    return value === null ? {} : (JSON.parse(value) as TokenStore);
  } catch {
    return {};
  }
}

function loadTokens(): TokenStore {
  if (!isStorageAvailable()) return {};
  return safeParse(window.sessionStorage.getItem(MC_TOKENS_STORAGE_KEY));
}

function saveTokens(tokens: TokenStore): void {
  if (!isStorageAvailable()) return;
  try {
    window.sessionStorage.setItem(MC_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Ignore storage errors (quota exceeded, etc) — same as the baseline.
  }
}

/** `mcpAuth.helpers.js`'s `isPrebuildMcpType` — kept for `getStorageKey`'s precedence order, though SharePoint never actually hits this branch. */
export function isPrebuildMcpType(toolkitType: string | undefined): boolean {
  return typeof toolkitType === 'string' && toolkitType.startsWith(MCP_PREBUILD_PREFIX) && toolkitType !== 'mcp';
}

/** `mcpAuth.helpers.js`'s `isCredentialScopedKey` — a `"<uuid>:<url>"` composite key (SharePoint's own `getSharepointConnectionTokenKey` output shape, `../helpers/token.helpers.ts`). */
function isCredentialScopedKey(key: string | undefined): boolean {
  if (key === undefined || key === '' || !key.includes('://')) return false;
  const prefix = key.split('://')[0] ?? '';
  return prefix.includes(':');
}

/** `mcpAuth.helpers.js`'s `canonicalizeServerUrl`. */
export function canonicalizeServerUrl(url: string): string {
  if (isCredentialScopedKey(url)) return url;
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    const path = parsed.pathname || '';
    const normalized = `${scheme}://${host}${port}${path}`;
    return normalized.endsWith('/') && (path === '/' || path === '') ? normalized.slice(0, -1) : normalized;
  } catch {
    return url;
  }
}

export interface GetStorageKeyInput {
  readonly serverUrl?: string | undefined;
  readonly toolkitType?: string | undefined;
}

/** `mcpAuth.helpers.js`'s `getStorageKey`. */
export function getStorageKey({ serverUrl, toolkitType }: GetStorageKeyInput): string | null {
  if (isPrebuildMcpType(toolkitType)) return toolkitType as string;
  if (serverUrl && isCredentialScopedKey(serverUrl)) return serverUrl;
  if (serverUrl) return canonicalizeServerUrl(serverUrl);
  return null;
}

function isExpired(tokenInfo: StoredToken | undefined): boolean {
  return Boolean(tokenInfo?.expires_at) && Date.now() > Number(tokenInfo?.expires_at);
}

function dispatchTokenChangeEvent(key: string, type: 'login' | 'logout'): void {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(MCP_TOKEN_CHANGE_EVENT, { detail: { serverUrl: key, type } });
  window.dispatchEvent(event);
}

/** `mcpAuth.helpers.js`'s `getAccessToken`. */
export function getAccessToken(serverUrl: string | undefined, toolkitType?: string): string | null {
  const key = getStorageKey({ serverUrl, toolkitType });
  if (key === null) return null;
  const tokenInfo = loadTokens()[key];
  if (!tokenInfo || isExpired(tokenInfo)) return null;
  return tokenInfo.access_token ?? null;
}

/** `mcpAuth.helpers.js`'s `logout`. */
export function logout(serverUrl: string | undefined, toolkitType?: string): void {
  const key = getStorageKey({ serverUrl, toolkitType });
  if (key === null) return;
  const tokens = loadTokens();
  if (tokens[key]) {
    const next = { ...tokens };
    delete next[key];
    saveTokens(next);
    dispatchTokenChangeEvent(key, 'logout');
  }
}

/**
 * `mcpAuth.helpers.js`'s `setConnectionVerified` — marks a header-based-auth
 * connection (no real OAuth token, e.g. SharePoint's non-delegated case) as
 * verified so `getAccessToken` returns truthy and `useSharepointTokenStatus`
 * flips to "connected".
 */
export function setConnectionVerified(serverUrl: string | undefined, toolkitType?: string): void {
  const key = getStorageKey({ serverUrl, toolkitType });
  if (key === null) return;
  if (getAccessToken(serverUrl, toolkitType) !== null) return;
  const tokens = loadTokens();
  const now = Date.now();
  tokens[key] = {
    access_token: MCP_CONNECTION_VERIFIED,
    issued_at: now,
    expires_at: now + 24 * 60 * 60 * 1000,
    connection_verified: true,
    ...(toolkitType !== undefined && { toolkit_type: toolkitType }),
  };
  saveTokens(tokens);
  dispatchTokenChangeEvent(key, 'login');
}
