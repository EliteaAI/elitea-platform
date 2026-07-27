/**
 * Mcp domain type — an MCP (Model Context Protocol) server integration. A
 * specialisation of `entities/toolkit` (`type === 'mcp'` or a `mcp_*`
 * pre-built type), plus client-held OAuth session state. No OpenAPI schema
 * exists for this resource (chat/agent-authoring domain, not in the W2
 * manifest).
 *
 * Evidence:
 * - apps/elitea-ui/src/[fsd]/shared/lib/helpers/mcp.helpers.js:7-14 —
 *   `isMcpToolkitType`/`isMcpToolkit` detector (`type === 'mcp'` OR
 *   `type` starts with `mcp_` OR `meta.mcp === true`).
 * - apps/elitea-ui/src/[fsd]/features/mcp/lib/constants/mcAuth.constants.js
 *   :1-9 — localStorage key literals (`elitea_mcp_tokens_v1` etc., ported
 *   into `shared/lib/storage.ts`'s `el.` namespace by a later unit, not
 *   duplicated here).
 * - apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuth.helpers.js:
 *   151-274 — token-info shape (`setAccessToken`) and expiry logic.
 * - apps/elitea-ui/src/[fsd]/pages/toolkits/components/Card.jsx:298-300 —
 *   "is connected" = server-pushed `online` OR a live client OAuth token.
 *
 * `Toolkit`'s shape is declared inline rather than imported, per the
 * dependency-cruiser `no-sideways-entities` rule.
 */

export interface McpTokenInfo {
  readonly accessToken: string;
  /** Epoch milliseconds. */
  readonly issuedAt: number;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly sessionId?: string;
  readonly idToken?: string;
  readonly refreshToken?: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly projectId: string;
  readonly toolkitId: string;
  readonly toolkitType: string;
  readonly authorizationEndpoint?: string;
  readonly revocationEndpoint?: string;
  readonly registrationEndpoint?: string;
  readonly issuer?: string;
}

export interface McpServer {
  readonly toolkitId: string;
  readonly name: string;
  /** `"mcp"` (remote) or a `mcp_*` pre-built type. */
  readonly type: string;
  readonly serverUrl?: string;
  /** Server-pushed via the `mcp_status` socket event. */
  readonly online?: boolean;
  readonly tokenInfo?: McpTokenInfo;
}
