/**
 * Dynamic Client Registration (DCR) — port of the network-calling half of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpDiscovery.helpers.js
 * (unit A5, manifest API-166). The pure metadata extractors from the same
 * baseline file live in `discoveryMetadata.ts`; split so this file (the one
 * that calls the network) stays a single, obviously-side-effecting unit.
 */
import { registerMcpDynamicClient } from '../api/mcpOAuthClient';

const DCR_REQUEST_DEFAULTS = {
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ELITEA MCP Client',
  application_type: 'web',
} as const;

/**
 * Registers a dynamic OAuth client via the backend's DCR proxy (avoids CORS
 * against the external OAuth server). Returns the issued `client_id`.
 */
export async function registerDynamicClient(registrationEndpoint: string, redirectUri: string, projectId: string | number | undefined): Promise<string> {
  const registration = await registerMcpDynamicClient({
    projectId: projectId ?? 1,
    registration_endpoint: registrationEndpoint,
    redirect_uris: [redirectUri],
    client_name: DCR_REQUEST_DEFAULTS.client_name,
    grant_types: DCR_REQUEST_DEFAULTS.grant_types,
    response_types: DCR_REQUEST_DEFAULTS.response_types,
    token_endpoint_auth_method: DCR_REQUEST_DEFAULTS.token_endpoint_auth_method,
    application_type: DCR_REQUEST_DEFAULTS.application_type,
  });

  if (!registration.client_id) {
    throw new Error('Registration response missing client_id');
  }

  return registration.client_id;
}
