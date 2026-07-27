import type { McpTokenInfo } from './types';

/**
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuth.helpers.js:
 * 151-166 `isExpired` — the token has passed its `expires_at` instant.
 * `now` is an injected parameter (not `Date.now()`) to keep this pure.
 */
export function isMcpTokenExpired(token: McpTokenInfo, now: number): boolean {
  return now >= token.expiresAt;
}

/**
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuth.helpers.js:
 * 167-190ish `needsProactiveRefresh` — true once the token has consumed 75%
 * of its lifetime (`issuedAt` -> `expiresAt` window), even though it has not
 * technically expired yet.
 */
export function needsProactiveRefresh(token: McpTokenInfo, now: number): boolean {
  const lifetime = token.expiresAt - token.issuedAt;
  if (lifetime <= 0) return true;
  const elapsed = now - token.issuedAt;
  return elapsed / lifetime >= 0.75;
}

/**
 * apps/elitea-ui/src/[fsd]/pages/toolkits/components/Card.jsx:298-300 —
 * "is connected" combines the server-pushed `online` flag with a live
 * client OAuth token (not expired).
 */
export function isMcpConnected(online: boolean | undefined, token: McpTokenInfo | undefined, now: number): boolean {
  if (online === true) return true;
  return token !== undefined && !isMcpTokenExpired(token, now);
}
