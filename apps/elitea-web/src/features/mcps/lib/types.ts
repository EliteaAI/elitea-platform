/**
 * Local (slice-private) types for the MCP OAuth flow (unit A5).
 *
 * `StoredMcpToken` is the on-disk wire shape persisted by `storage.ts` —
 * snake_case, matching the old app's `tokens[key]` record
 * (`mcAuth.helpers.js:250-274`) and the backend's OAuth-proxy response
 * fields (`access_token`, `expires_in`, ...). This is deliberately NOT
 * `entities/mcp`'s `McpTokenInfo` (camelCase, a curated public projection
 * for consumers outside this slice) — the two are related but not
 * identical, and keeping the wire shape local avoids forcing every
 * internal helper to translate case for no benefit. `toPublicTokenInfo()`
 * bridges the two where a caller needs the public shape.
 */

/**
 * A single stored OAuth token record, keyed by `getStorageKey()`'s result.
 * Optional fields are `T | undefined` (not bare `?: T`) — `storage.ts`'s
 * `setAccessToken` constructs this from a mix of freshly-computed and
 * carried-forward-from-existing values, both of which are legitimately
 * `undefined` (`exactOptionalPropertyTypes`).
 */
export interface StoredMcpToken {
  access_token: string;
  issued_at: number;
  expires_at: number | null;
  session_id?: string | undefined;
  id_token?: string | undefined;
  refresh_token?: string | undefined;
  token_endpoint?: string | undefined;
  client_id?: string | undefined;
  client_secret?: string | undefined;
  project_id?: string | undefined;
  toolkit_id?: string | undefined;
  toolkit_type?: string | undefined;
  authorization_endpoint?: string | undefined;
  revocation_endpoint?: string | undefined;
  registration_endpoint?: string | undefined;
  issuer?: string | undefined;
  grant_types_supported?: readonly string[] | undefined;
  code_challenge_methods_supported?: readonly string[] | undefined;
  connection_verified?: boolean | undefined;
  /**
   * True when this token's `client_id`/`client_secret` were issued by
   * Dynamic Client Registration rather than caller-supplied or toolkit-DB
   * credentials (baseline: `mcpAuthFlow.helpers.js:497,536`). Once set, a
   * proactive refresh must never let the toolkit-API credential fallback
   * (`tokenLifecycle.ts`'s `applyToolkitCredentialFallback`) substitute a
   * different OAuth client for the refresh_token grant.
   */
  used_dcr?: boolean | undefined;
}

export type StoredMcpTokenMap = Record<string, StoredMcpToken>;

/**
 * Fields are `T | undefined`, not bare `?: T` — under `exactOptionalPropertyTypes`
 * every one of these is legitimately CONSTRUCTED from a computed,
 * possibly-absent value (`savedCredentials?.client_secret`, a form field
 * that may be empty), so the call sites need to be able to pass `undefined`
 * explicitly rather than needing to conditionally omit the key.
 */
export interface StoredMcpCredential {
  client_id?: string | undefined;
  client_secret?: string | undefined;
}

export type StoredMcpCredentialMap = Record<string, StoredMcpCredential>;

interface IgnoredServerEntry {
  ignored_at: number;
  server_url: string;
}

export type IgnoredServerMap = Record<string, IgnoredServerEntry>;

/**
 * OAuth authorization-server metadata, however it was obtained
 * (`mcp_authorization_required` message, discovery probe, or manual
 * entry). Every field is `T | undefined` (not bare `?: T`) for the same
 * `exactOptionalPropertyTypes` reason as `StoredMcpCredential` above —
 * `discoveryMetadata.ts`/`remoteDiscoveryClient.ts` construct these from
 * defensively-read, possibly-absent source fields.
 */
export interface OAuthServerMetadata {
  issuer?: string | undefined;
  authorization_endpoint?: string | undefined;
  token_endpoint?: string | undefined;
  revocation_endpoint?: string | undefined;
  registration_endpoint?: string | undefined;
  userinfo_endpoint?: string | undefined;
  scopes_supported?: readonly string[] | undefined;
  grant_types_supported?: readonly string[] | undefined;
  response_types_supported?: readonly string[] | undefined;
  code_challenge_methods_supported?: readonly string[] | undefined;
  token_endpoint_auth_methods_supported?: readonly string[] | undefined;
  /** Extra fields the metadata source may include; read defensively elsewhere, same posture as socket `response_metadata`. */
  [key: string]: unknown;
}

/** `provided_settings` — pre-built-MCP credentials the backend already resolved server-side. */
export interface McpProvidedSettings {
  mcp_client_id?: string | undefined;
  mcp_client_secret?: string | undefined;
  scopes?: string | readonly string[] | undefined;
}

/** The shape `extractMcpAuthMetadata`/`extractConfigAuthMetadata` normalise to — what `McpAuthModal` consumes. */
export interface McpAuthMetadata {
  authServers?: readonly string[] | undefined;
  oauthAuthorizationServer?: OAuthServerMetadata | undefined;
  oauthMetadata?: Partial<OAuthServerMetadata> | null | undefined;
  providedSettings?: McpProvidedSettings | undefined;
  resourceScopes?: readonly string[] | undefined;
  configurationUuid?: string | undefined;
  toolkitId?: string | undefined;
}
