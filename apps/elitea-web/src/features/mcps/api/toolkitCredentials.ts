/**
 * Narrow, read-only toolkit-credentials lookup — hand-written fallback for
 * `oauthFlow.ts`'s `triggerProactiveRefresh` (baseline:
 * `mcpAuthFlow.helpers.js:27-43`'s `fetchToolkitCredentials`, which called
 * `toolkitsApi.endpoints.toolkitsDetails.initiate(...)`, a toolkits-domain
 * RTK Query endpoint — `apps/elitea-ui/src/api/toolkits.js:122-144`,
 * `GET /elitea_core/tool/prompt_lib/{projectId}/{toolkitId}`).
 *
 * OWNERSHIP NOTE: full toolkit CRUD (list/create/edit screens, the generic
 * `Toolkit` read model) is unit A4's (`src/features/toolkits/**`), not this
 * unit's — `parity/wave2-partition.json`'s A5 `sourceFiles` deliberately
 * excludes `toolkitsDetails`/`Toolkits.jsx`/`CreateToolkit.jsx`/
 * `EditToolkit.jsx`. This file does NOT build toolkit UI or a toolkits
 * domain model; it is a single, minimal, read-only GET this slice's OWN
 * refresh logic needs when a stored MCP token has no `client_id` cached
 * (baseline: only reached when `resolveCredentials` found nothing) — the
 * response is read defensively for exactly the 3 OAuth-credential fields
 * `triggerProactiveRefresh` uses, not modelled as a general `Toolkit`.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

export interface ToolkitOAuthSettings {
  client_id?: string;
  client_secret?: string;
  token_endpoint?: string;
}

interface ToolkitDetailsResponse {
  settings?: ToolkitOAuthSettings;
}

/**
 * `GET /elitea_core/tool/prompt_lib/{projectId}/{toolkitId}`, read
 * defensively for `settings.{client_id,client_secret,token_endpoint}` only.
 * Returns `null` on any failure (network, 4xx, missing settings) — the
 * baseline treats this as a best-effort fallback (`mcpAuthFlow.helpers.js:39-41`'s
 * empty `catch`), not a hard dependency.
 */
export async function getToolkitOAuthSettings(projectId: string | number, toolkitId: string): Promise<ToolkitOAuthSettings | null> {
  try {
    // `eliteaFetch<T>` resolves to the enveloped `{data: T, status, headers}`
    // shape (see `mcpOAuthClient.ts`'s header for the same note).
    const envelope = await eliteaFetch<{ data: ToolkitDetailsResponse }>(
      `/elitea_core/tool/prompt_lib/${projectId}/${toolkitId}`,
      { method: 'GET' },
    );
    return envelope.data?.settings ?? null;
  } catch {
    return null;
  }
}
