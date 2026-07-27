/**
 * User-initiated OAuth authorization-code flow — port of
 * `startMcpAuthFlow` from
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuthFlow.helpers.js
 * (unit A5, spec §9.3). The background-refresh half lives in
 * `tokenLifecycle.ts` (split rationale there).
 *
 * `getRedirectUri()` deviates from the baseline's `RouteDefinitions.McpAuthPage`
 * + `getBasename()` (both live in `src/app/**`/`src/routes/**`, which
 * `features/` may not import — R-L1, layers flow strictly downward). The
 * `/mcp-auth-callback` path is a literal (matches `src/routes/_shell/
 * mcp-auth-callback.tsx`'s mounted pattern exactly — spec ROUTE-050) and the
 * basename is re-derived from `shared/config` using the SAME two-branch
 * logic `src/app/providers/basename.ts`'s `getAppBasename()` encodes
 * (`import.meta.env.DEV` ? '' : `config.vite_base_uri`) — both read the
 * identical source of truth, just from a layer this slice is allowed to
 * import.
 */
import { getConfig } from '@/shared/config';

import { exchangeMcpOAuthToken } from '../api/mcpOAuthClient';
import type { McpOAuthTokenResponse } from '../api/mcpOAuthClient';

import { MCP_OAUTH_ERRORS } from './constants';
import { normalizeScope, randomString, sha256, isOIDCFlow } from './crypto';
import { extractAuthServerMetadata } from './discoveryMetadata';
import { registerDynamicClient } from './registerDynamicClient';
import { isPrebuildMcpType, setAccessToken } from './storage';
import type { OAuthServerMetadata } from './types';
import { createAuthorizationMonitor, navigateAuthPopup, openAuthPopup } from './window';

const MCP_AUTH_CALLBACK_PATH = '/mcp-auth-callback';

function getMcpAuthCallbackBasename(): string {
  if (import.meta.env.DEV) return '';
  const result = getConfig();
  return result.status === 'ok' ? result.config.vite_base_uri : '';
}

function getRedirectUri(): string {
  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  return `${baseUrl}${getMcpAuthCallbackBasename()}${MCP_AUTH_CALLBACK_PATH}`;
}

interface AuthorizationUrlOptions {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge?: string | undefined;
  usePKCE: boolean;
  scope?: string | undefined;
  isOIDC: boolean;
  prompt?: string | undefined;
}

function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  const { authorizationEndpoint, clientId, redirectUri, state, nonce, codeChallenge, usePKCE, scope, isOIDC, prompt } = options;

  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state });

  if (usePKCE && codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (isOIDC) params.set('nonce', nonce);
  if (scope) params.set('scope', scope);
  if (prompt) params.set('prompt', prompt);

  return `${authorizationEndpoint}?${params.toString()}`;
}

function waitForAuthorizationResult(authWindow: Window, state: string): Promise<{ code?: string }> {
  return new Promise((resolve, reject) => {
    createAuthorizationMonitor(authWindow, state, resolve, reject);
  });
}

/**
 * The phases below split `startMcpAuthFlow`'s single-function body (§3.5
 * complexity budget: the inlined form measured 27) into one function per
 * flow step — popup acquisition, client-credential resolution, PKCE
 * material, the redirect-and-await, the token exchange, and the persisted
 * metadata shape. Each keeps its own well-under-budget complexity; the
 * orchestrating function just sequences them.
 */

/** Uses the caller-supplied window, or opens a fresh popup — throws `POPUP_BLOCKED` if that fails (baseline: browsers blocking a popup not opened synchronously from a click). */
function ensureAuthWindow(providedWindow: Window | null | undefined): Window {
  if (providedWindow) return providedWindow;
  const opened = openAuthPopup();
  if (!opened) {
    throw new Error(`${MCP_OAUTH_ERRORS.POPUP_BLOCKED}. Please allow popups for this site and try again.`);
  }
  return opened;
}

interface ClientCredentialsResolution {
  clientId: string;
  usedDCR: boolean;
}

/** A caller-provided `client_id` wins outright; otherwise Dynamic Client Registration if the server supports it; otherwise the flow cannot proceed. */
async function resolveClientCredentials(
  registrationEndpoint: string | undefined,
  initialClientId: string | undefined,
  projectId: string | number | undefined,
): Promise<ClientCredentialsResolution> {
  if (initialClientId) return { clientId: initialClientId, usedDCR: false };
  if (registrationEndpoint) {
    const redirectUri = getRedirectUri();
    const clientId = await registerDynamicClient(registrationEndpoint, redirectUri, projectId);
    return { clientId, usedDCR: true };
  }
  throw new Error(
    `${MCP_OAUTH_ERRORS.MISSING_CLIENT_ID}. Server does not support Dynamic Client Registration. Please register an OAuth application manually and provide client credentials.`,
  );
}

interface PkceMaterial {
  usePKCE: boolean;
  codeVerifier: string | undefined;
  codeChallenge: string | undefined;
}

/** PKCE is used whenever the server advertises S256 support, or whenever no `client_secret` was supplied (a public client has no other way to prove possession). */
async function resolvePkceMaterial(asMetadata: OAuthServerMetadata, clientSecret: string | undefined): Promise<PkceMaterial> {
  const serverSupportsPKCE = asMetadata.code_challenge_methods_supported?.includes('S256') ?? false;
  const usePKCE = serverSupportsPKCE || !clientSecret;
  if (!usePKCE) return { usePKCE, codeVerifier: undefined, codeChallenge: undefined };
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256(codeVerifier);
  return { usePKCE, codeVerifier, codeChallenge };
}

/** Navigates the popup to the authorization URL and resolves with the redirected `code` — throws if the callback carried none (an OAuth error, or a malformed redirect). */
async function awaitAuthorizationCode(authWindow: Window, authUrl: string, state: string): Promise<string> {
  navigateAuthPopup(authWindow, authUrl);
  const result = await waitForAuthorizationResult(authWindow, state);
  if (!result.code) {
    throw new Error('No authorization code received from popup');
  }
  return result.code;
}

interface ExchangeAuthorizationCodeParams {
  projectId: string | number | undefined;
  tokenEndpoint: string | undefined;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string | undefined;
  usedDCR: boolean;
  isPrebuildMcp: boolean;
  usePKCE: boolean;
  codeVerifier: string | undefined;
  normalizedScope: string | undefined;
  toolkitId: string | undefined;
  toolkitType: string | undefined;
}

/** Trades the authorization code for a token — credentials (`client_id`/`client_secret`) are sent only when DCR issued them or the toolkit isn't a pre-built MCP (baseline: pre-built MCPs with backend-resolved credentials must not leak them client-side). */
async function exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<McpOAuthTokenResponse> {
  const shouldSendCredentials = params.usedDCR || !params.isPrebuildMcp;

  const tokenJson = await exchangeMcpOAuthToken({
    projectId: params.projectId ?? 1,
    token_endpoint: params.tokenEndpoint,
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: shouldSendCredentials ? (params.clientId ?? undefined) : undefined,
    client_secret: shouldSendCredentials ? params.clientSecret : undefined,
    code_verifier: params.usePKCE ? params.codeVerifier : undefined,
    scope: params.normalizedScope || undefined,
    toolkit_id: params.toolkitId,
    toolkit_type: params.isPrebuildMcp ? params.toolkitType : undefined,
    used_dcr: params.usedDCR || undefined,
  });

  if (!tokenJson.access_token) {
    throw new Error('No access token received from token exchange');
  }
  return tokenJson;
}

interface TokenPersistenceMetadataParams {
  tokenEndpoint: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  projectId: string | number | undefined;
  toolkitId: string | undefined;
  providedOauthMetadata: Partial<OAuthServerMetadata> | null | undefined;
  usedDCR: boolean;
}

/** The extra fields `setAccessToken` persists alongside the token itself, so a later proactive refresh (`tokenLifecycle.ts`) has everything it needs without re-discovering the server. */
function buildTokenPersistenceMetadata(params: TokenPersistenceMetadataParams) {
  return {
    token_endpoint: params.tokenEndpoint,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    project_id: params.projectId === undefined ? undefined : String(params.projectId),
    toolkit_id: params.toolkitId,
    // Baseline: `mcpAuthFlow.helpers.js:536` persists `used_dcr` alongside
    // the token so a later proactive refresh (`tokenLifecycle.ts`) never
    // lets the toolkit-API credential fallback overwrite a DCR-issued
    // client_id/secret with an unrelated toolkit-DB OAuth client.
    used_dcr: params.usedDCR || undefined,
    ...(params.providedOauthMetadata
      ? {
          authorization_endpoint: params.providedOauthMetadata.authorization_endpoint,
          revocation_endpoint: params.providedOauthMetadata.revocation_endpoint,
          registration_endpoint: params.providedOauthMetadata.registration_endpoint,
          issuer: params.providedOauthMetadata.issuer,
          grant_types_supported: params.providedOauthMetadata.grant_types_supported,
          code_challenge_methods_supported: params.providedOauthMetadata.code_challenge_methods_supported,
        }
      : {}),
  };
}

export interface StartMcpAuthFlowOptions {
  serverUrl?: string | undefined;
  resourceMetadata: { authorization_servers?: readonly string[] | undefined; oauth_authorization_server?: OAuthServerMetadata | undefined };
  oauthMetadata?: Partial<OAuthServerMetadata> | null | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  scope?: string | undefined;
  authWindow?: Window | null | undefined;
  projectId?: string | number | undefined;
  toolkitId?: string | undefined;
  /** Pre-built MCP type (e.g. `mcp_github`) — used as the storage key when set. */
  toolkitType?: string | undefined;
}

/**
 * Full authorization-code + PKCE flow: resolve auth-server metadata ->
 * (DCR or require a caller-provided client_id) -> open/navigate the popup
 * -> await the redirected code -> exchange it -> persist the token.
 * Throws on any step failure (POPUP_BLOCKED, MISSING_CLIENT_ID, a rejected
 * exchange, ...) — the caller (an OAuth modal) surfaces this as an inline
 * error, matching the baseline.
 */
export async function startMcpAuthFlow(options: StartMcpAuthFlowOptions): Promise<{ access_token: string; expires_in?: number; session_id?: string; id_token?: string; refresh_token?: string }> {
  const { serverUrl, resourceMetadata, oauthMetadata: providedOauthMetadata, clientId: initialClientId, clientSecret, scope, authWindow: initialAuthWindow, projectId, toolkitId, toolkitType } = options;

  const isPrebuildMcp = isPrebuildMcpType(toolkitType);
  if (!serverUrl && !isPrebuildMcp) {
    throw new Error('Missing MCP server URL');
  }

  const authWindow = ensureAuthWindow(initialAuthWindow);

  const asMetadata = extractAuthServerMetadata(resourceMetadata);
  const { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, registration_endpoint: registrationEndpoint } = asMetadata;

  const { clientId, usedDCR } = await resolveClientCredentials(registrationEndpoint, initialClientId, projectId);

  const state = randomString(32);
  const nonce = randomString(32);
  const redirectUri = getRedirectUri();
  const isOIDC = isOIDCFlow(asMetadata);

  const { usePKCE, codeVerifier, codeChallenge } = await resolvePkceMaterial(asMetadata, clientSecret);
  const normalizedScope = normalizeScope(scope, isOIDC);

  const authUrl = buildAuthorizationUrl({
    authorizationEndpoint: authorizationEndpoint as string,
    clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge,
    usePKCE,
    scope: normalizedScope,
    isOIDC,
    prompt: isOIDC ? 'consent' : undefined,
  });

  const code = await awaitAuthorizationCode(authWindow, authUrl, state);

  const tokenJson = await exchangeAuthorizationCode({
    projectId,
    tokenEndpoint,
    code,
    redirectUri,
    clientId,
    clientSecret,
    usedDCR,
    isPrebuildMcp,
    usePKCE,
    codeVerifier,
    normalizedScope,
    toolkitId,
    toolkitType,
  });

  const sessionId = tokenJson.session_id ?? undefined;

  setAccessToken(
    serverUrl,
    tokenJson.access_token,
    tokenJson.expires_in,
    sessionId,
    tokenJson.id_token,
    tokenJson.refresh_token,
    buildTokenPersistenceMetadata({ tokenEndpoint, clientId, clientSecret, projectId, toolkitId, providedOauthMetadata, usedDCR }),
    toolkitType,
  );

  return tokenJson;
}
