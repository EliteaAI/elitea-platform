/**
 * `features/toolkits/sharepoint/lib/api/configurations.ts` — hand-registered
 * fetchers for exactly the two `/configurations/*` operations SharePoint's
 * hooks need (`GET /configurations/configurations/{projectId}` filtered by
 * `type=sharepoint`, `POST /configurations/check_connection/{projectId}/
 * {configType}`).
 *
 * **Duplicated, not imported, from `features/credentials/api/
 * configurations.ts`** (the full `/configurations/*` surface, API-145..160)
 * — `no-sideways-features` forbids `features/toolkits` importing
 * `features/credentials`. Same per-slice-duplication convention this
 * session has used repeatedly — `features/agents/api/configurations.ts`
 * (this unit's own direct template: identical two-endpoint subset, same
 * `fetchData` wrapper, same citation of "the target endpoints already carry
 * real `endpoints.manifest.json` entries; this unit adds
 * `\"features/toolkits\"` to both entries' `usedBy` arrays rather than
 * registering duplicate ids for the same wire endpoint").
 *
 * Ported from `apps/elitea-ui/src/api/configurations.js`'s
 * `getConfigurationsByType`/`testConfigurationConnection` operations, the
 * same ones `apps/elitea-ui/src/[fsd]/features/sharepoint/lib/hooks/
 * useResolvedSharepointConfig.hooks.js`/`useSharepointCheckConnection.hooks.js`
 * call via `useGetConfigurationsByTypeQuery`/`useTestConfigurationConnectionMutation`
 * (RTK Query — no TanStack-Query-hook wrapper is added here; both baseline
 * hooks already reduce to a single non-cached read-on-mount / imperative
 * mutation, which `../hooks/useResolvedSharepointConfig.hooks.ts`/
 * `../hooks/useSharepointCheckConnection.hooks.ts` call directly).
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ readonly data: T }>(url, options);
  return envelope.data;
}

/**
 * One row of `getConfigurationsByType`'s response. `uuid`/`uid` are BOTH
 * kept: the baseline sharepoint hook (`useResolvedSharepointConfig.hooks.js:25`)
 * reads `resolvedCred.uuid`, but `features/credentials/api/configurations.ts`'s
 * own `ConfigurationWire` — read directly off the SAME real wire responses
 * per its own doc comment ("Response shapes are NOT documented by any
 * spec... read directly off... its consumers") — types the row identifier
 * as `uid`, not `uuid`. Genuinely ambiguous without a live response to
 * check (no OpenAPI schema exists for this resource either way, per that
 * same file); this reads whichever is present rather than silently trusting
 * one source over the other.
 */
export interface ConfigurationWire {
  readonly id?: string | number;
  readonly uid?: string;
  readonly uuid?: string;
  readonly type: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly elitea_title?: string;
  readonly [key: string]: unknown;
}

export interface ConfigurationPageWire {
  readonly items: readonly ConfigurationWire[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

const DEFAULT_PAGE_SIZE = 20;

/** API-147 / `credentials.getConfigurationsByType`. */
export async function getConfigurationsByType(
  projectId: string,
  type: string,
  signal?: AbortSignal,
): Promise<ConfigurationPageWire> {
  const search = new URLSearchParams();
  search.append('type', type);
  search.append('limit', String(DEFAULT_PAGE_SIZE));
  search.append('offset', '0');
  return fetchData<ConfigurationPageWire>(
    `/configurations/configurations/${projectId}?${search.toString()}`,
    signal ? { signal } : {},
  );
}

export interface TestConnectionResult {
  readonly error?: string;
  readonly requires_authorization?: boolean;
  readonly auth_metadata?: unknown;
  readonly [key: string]: unknown;
}

/** API-154 / `credentials.testConfigurationConnection`. */
export async function testConfigurationConnection(
  projectId: string,
  configType: string,
  body: Readonly<Record<string, unknown>>,
): Promise<TestConnectionResult> {
  return fetchData<TestConnectionResult>(`/configurations/check_connection/${projectId}/${configType}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
