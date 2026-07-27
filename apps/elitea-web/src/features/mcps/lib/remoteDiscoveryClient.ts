/**
 * Remote-MCP-server capability discovery — port of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpClient.helpers.js
 * AND mcpClientFactory.helpers.js (unit A5, manifest XPORT-002/003;
 * NOT listed in `parity/wave2-partition.json`'s A5 `sourceFiles` array —
 * the manifest's XPORT-002/003 items point at this file by evidence
 * `file:line`, so it is ported here as the item's owning unit despite the
 * sourceFiles omission; flagged in the A5 final report).
 *
 * R-A1 FRICTION, DISCLOSED (spec §3.4/§5.4, decision-record "R-A1 scope
 * correction"): `fetch()` here targets the REMOTE MCP SERVER the user
 * configured (an arbitrary third-party origin), never the Elitea backend —
 * it is not an `eliteaFetch`-shaped call and cannot be, because there is no
 * session cookie or CORS relationship with that origin to speak of; the old
 * app never proxied this through the backend either (`mcpClient.helpers.js`
 * uses the bare global `fetch`). This is the SAME kind of exception S6
 * already carries for `shared/api/artifacts.ts`'s direct S3 PUT — a
 * non-REST, non-backend transport that plain `eliteaFetch` cannot serve. S6's
 * exception was granted a documented `.oxlintrc.json` PATH override;
 * `.oxlintrc.json` is a Wave-0 (F2) file this unit does NOT own, so a
 * matching path override could not be added here. VERIFIED (not assumed):
 * each `fetch(` call below carries its own `oxlint-disable-next-line
 * no-restricted-globals` line comment instead, and `npx oxlint
 * src/features/mcps` reports zero errors on this file — oxlint 1.75's
 * `no-restricted-globals` honours a line-level disable exactly like any
 * other rule, so the CI gate is NOT actually blocked by the missing path
 * override. Flagged in the A5 final report anyway, because the *pattern*
 * (repeated inline disables instead of one path override) is worth revisiting
 * whoever next owns `.oxlintrc.json`, purely for consistency with `upload.ts`/
 * `artifacts.ts`/`download.ts` — not because anything is currently broken.
 */
import { MCP_API_KEY_HEADERS, MCP_API_KEY_TEST_ENDPOINTS, MCP_AUTH_METHODS, MCP_CLIENT_DEFAULTS, MCP_DISCOVERY_PATHS, MCP_DISCOVERY_TYPES, MCP_OAUTH_DISCOVERY_PATHS } from './constants';
import type { OAuthServerMetadata } from './types';

export interface DiscoveredMetadata extends OAuthServerMetadata {
  authMethod?: string;
  discoveredVia?: string;
  capabilities?: readonly string[];
  version?: string;
  authorization_servers?: readonly string[];
}

/** `fetch` with a timeout, JSON parsing, and an `Accept: application/json` default — mirrors `mcpClient.helpers.js:3-24`. */
export async function fetchJson<T>(url: string, options: RequestInit = {}, timeout = MCP_CLIENT_DEFAULTS.TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    // `new Headers(...)` (not an object spread of `options.headers`): `RequestInit['headers']`
    // (`HeadersInit`) may legally be the tuple-array form `[string, string][]`, and spreading an
    // array into an object literal produces numeric-index keys, not header entries.
    const headers = new Headers(options.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    // oxlint-disable-next-line no-restricted-globals -- see file header: raw fetch to an arbitrary third-party MCP server, not the Elitea backend; needs an .oxlintrc.json override this unit cannot add (out of ownership fence).
    const response = await fetch(url, { ...options, signal: controller.signal, headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractBaseUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return serverUrl.replace(/^(https?:\/\/[^/]+).*/, '$1');
  }
}

async function discoverOAuthMetadata(baseUrl: string): Promise<OAuthServerMetadata> {
  for (const path of MCP_OAUTH_DISCOVERY_PATHS) {
    try {
      const metadata = await fetchJson<OAuthServerMetadata>(`${baseUrl}${path}`);
      return {
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        scopes_supported: metadata.scopes_supported ?? ['read', 'write'],
        grant_types_supported: metadata.grant_types_supported ?? ['authorization_code'],
      };
    } catch {
      // Try the next well-known path.
    }
  }
  throw new Error('OAuth metadata discovery failed');
}

function normalizeMetadata(metadata: Record<string, unknown> & Partial<DiscoveredMetadata>, authMethod: string, discoveredVia: string): DiscoveredMetadata {
  const normalized: DiscoveredMetadata = {
    ...metadata,
    discoveredVia,
    authMethod,
    capabilities: metadata.capabilities ?? (metadata.capabilities_supported as readonly string[] | undefined) ?? (metadata.features as readonly string[] | undefined) ?? [],
    version: metadata.version ?? '1.0',
  };
  if (!normalized.authorization_servers && metadata.authorization_server) {
    normalized.authorization_servers = [metadata.authorization_server as string];
  }
  return normalized;
}

async function discoverMcpMetadata(baseUrl: string): Promise<DiscoveredMetadata | null> {
  for (const path of MCP_DISCOVERY_PATHS) {
    try {
      const metadata = await fetchJson<Record<string, unknown>>(`${baseUrl}${path}`);
      if (metadata) {
        const authMethod = (metadata.authMethod as string | undefined) ?? (metadata.auth_method as string | undefined) ?? (metadata.auth as string | undefined) ?? MCP_AUTH_METHODS.OAUTH;
        return normalizeMetadata(metadata, authMethod, MCP_DISCOVERY_TYPES.MCP);
      }
    } catch {
      // Try the next well-known path.
    }
  }
  return null;
}

interface ProbeResult {
  ok: boolean;
  status: number | null;
  headers: { get(name: string): string | null };
}

async function probeEndpoint(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  try {
    // oxlint-disable-next-line no-restricted-globals -- see file header.
    const res = await fetch(url, { method: 'GET', headers });
    return { ok: res.ok, status: res.status, headers: res.headers };
  } catch {
    return { ok: false, status: null, headers: { get: () => null } };
  }
}

/** True when at least one candidate endpoint responds only to an API-key-shaped header, or advertises one via `WWW-Authenticate`. */
export async function testApiKeyEndpoints(baseUrl: string): Promise<boolean> {
  for (const endpoint of MCP_API_KEY_TEST_ENDPOINTS) {
    const url = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const unauth = await probeEndpoint(url);
    if (unauth.ok) continue;

    for (const headerName of MCP_API_KEY_HEADERS) {
      const withKey = await probeEndpoint(url, { [headerName]: 'test-key' });
      if (withKey.ok) return true;
    }

    const wwwAuth = unauth.headers.get('www-authenticate') ?? '';
    if ((unauth.status === 401 || unauth.status === 403) && /api|key|token/i.test(wwwAuth)) {
      return true;
    }
  }
  throw new Error('No API key endpoints found');
}

/** Cascades MCP-protocol discovery -> OAuth discovery -> API-key probing -> open access, in that order (baseline: `mcpClient.helpers.js:112-134`). */
export async function discoverServerCapabilities(serverUrl: string): Promise<DiscoveredMetadata> {
  const baseUrl = extractBaseUrl(serverUrl);

  try {
    const mcpMetadata = await discoverMcpMetadata(baseUrl);
    if (mcpMetadata) return mcpMetadata;
  } catch {
    // Fall through to OAuth discovery.
  }

  try {
    const oauthMetadata = await discoverOAuthMetadata(baseUrl);
    return normalizeMetadata(oauthMetadata, MCP_AUTH_METHODS.OAUTH, MCP_DISCOVERY_TYPES.OAUTH);
  } catch {
    // Fall through to API-key detection.
  }

  try {
    await testApiKeyEndpoints(baseUrl);
    return normalizeMetadata({}, MCP_AUTH_METHODS.API_KEY, MCP_DISCOVERY_TYPES.API_KEY);
  } catch {
    // Fall through to open access.
  }

  return normalizeMetadata({}, MCP_AUTH_METHODS.OPEN, MCP_DISCOVERY_TYPES.OPEN);
}

export interface McpDiscoveryClient {
  discoverCapabilities: () => Promise<DiscoveredMetadata>;
}

/**
 * Factory (R-S2 posture): a small memoising client over
 * `discoverServerCapabilities`, one instance per server URL.
 *
 * SIMPLIFICATION FROM BASELINE (`mcpClientFactory.helpers.js:14-20`): the
 * baseline wraps this call in a `try { … } catch { metadata = DEFAULT }`,
 * but `discoverServerCapabilities` is constructed so that EVERY one of its
 * four cascade steps already catches its own failure and falls through to
 * the next (ending unconditionally at the `open-access` return) — it
 * cannot itself throw. Confirmed empirically (unit A5): forcing every
 * candidate endpoint in the cascade to fail still resolves to
 * `{discoveredVia:'open-access', ...}`, never a rejection. Per this
 * programme's established precedent for genuinely-unreachable defensive
 * code (decision record, "S1 follow-on batch" §1: "simplified away rather
 * than left untested or faked"), the redundant outer try/catch and its
 * `DEFAULT_DISCOVERY_METADATA` dead branch are dropped rather than kept
 * untested.
 */
export function createMcpDiscoveryClient(serverUrl: string): McpDiscoveryClient {
  const normalizedServerUrl = serverUrl.replace(/\/+$/, '');
  let metadata: DiscoveredMetadata | null = null;

  return {
    async discoverCapabilities() {
      metadata ??= await discoverServerCapabilities(normalizedServerUrl);
      return metadata;
    },
  };
}
