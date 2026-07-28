/**
 * features/pipelines/api/aiAssistantConfigurations.ts — hand-written
 * endpoint layer for the 2 `/configurations/*` reads the AI Assistant panel
 * needs (unit A2a; manifest API-145/API-146).
 *
 * WHY A LOCAL COPY, NOT AN IMPORT FROM `features/credentials`: the exact
 * same 2 endpoints are already implemented in
 * `features/credentials/api/configurations.ts` (unit A7,
 * `getAvailableConfigurationsType`/`getConfigurationsList`). This app's own
 * `.dependency-cruiser.cjs` `no-sideways-features` rule forbids
 * `features/pipelines` importing ANY `features/credentials` file — even a
 * single named symbol via its `index.ts` — so reuse across the slice
 * boundary is architecturally unavailable, not merely undesirable (see the
 * workflow preamble's "ALREADY-RESOLVED ARCHITECTURE FINDING"). Per R-A5
 * ("every network call must go through a generated or hand-registered
 * endpoint … and appear in endpoints.manifest.json"), these 2 fetchers call
 * `eliteaFetch` (the same transport A7's copy and every `shared/api/
 * generated/**` orval hook call — no new `fetch`/`XMLHttpRequest` site, so
 * R-A1/R-A4 are untouched) against the SAME wire contract A7 already
 * validated (byte-for-byte identical URL/query-param construction,
 * including the `sort_by`/`sort_order`/`query` defaults A7's own
 * `GetConfigurationsListParams.params` applies — this file's
 * `buildConfigurationsListUrl` mirrors that same optional-`params`-with-
 * defaults shape rather than omitting those 3 keys), and
 * `endpoints.manifest.json`'s existing `credentials.getAvailableConfigurationsType`/
 * `credentials.getConfigurationsList` entries gain `features/pipelines` in
 * their `usedBy` array (this is genuinely the SAME backend endpoint, used
 * by two slices — not a new endpoint id) rather than a duplicate entry.
 *
 * Scope: only the 2 of A7's 16 `/configurations/*` endpoints this panel's
 * `useAIContentGenerationStreaming`/`useServicePromptByKey` actually call
 * (baseline: `hooks/useServicePromptByKey.js`'s
 * `useGetConfigurationsListQuery`, `.../lib/hooks/
 * useAIContentGenerationStreaming.hooks.js`'s
 * `useGetAvailableConfigurationsTypeQuery`). The other 14 stay
 * `features/credentials`'s exclusive concern.
 *
 * Response shapes/URL construction are copied from A7's already-verified
 * contract (`features/credentials/api/configurations.ts`, itself ported
 * from `apps/elitea-ui/src/api/configurations.js`), not re-derived —
 * duplicating the verification would not change the answer.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

/** Envelope-unwrap, matching every hand-registered endpoint in this codebase (e.g. `features/credentials/api/configurations.ts#fetchData`). */
async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/**
 * A JSON-Schema-shaped node describing one credential/service-prompt
 * type's configurable fields. Only the fields this panel's
 * `getServicePromptDefaultsByKey` reads are typed; server-authored and
 * open-ended by nature. Not exported: nothing outside this file imports it
 * by name (`AiAssistantConfigurationTypeDescriptor.config_schema` is the
 * only reference) — `knip --max-issues 0` (R-D1) flags a zero-external-
 * importer export as dead.
 */
interface AiAssistantConfigSchemaNode {
  readonly type?: string;
  readonly properties?: {
    readonly data?: {
      readonly properties?: {
        readonly prompt?: {
          readonly default_by_key?: Readonly<Record<string, string>>;
        };
      };
    };
  };
  readonly [key: string]: unknown;
}

/** One row of `getAvailableConfigurationsType`'s response — a credential/service-prompt TYPE descriptor. */
export interface AiAssistantConfigurationTypeDescriptor {
  readonly type: string;
  readonly config_schema: AiAssistantConfigSchemaNode;
  readonly [key: string]: unknown;
}

/* ── API-145: GET /configurations/available/ ─────────────────────────────── */

export interface GetAvailableConfigurationsTypeParams {
  readonly section?: string;
}

export function buildAvailableConfigurationsTypeUrl(params: GetAvailableConfigurationsTypeParams = {}): string {
  const query = new URLSearchParams();
  if (params.section !== undefined && params.section !== '') query.append('section', params.section);
  return `/configurations/available/?${query.toString()}`;
}

export async function getAvailableConfigurationsType(
  params: GetAvailableConfigurationsTypeParams = {},
  signal?: AbortSignal,
): Promise<AiAssistantConfigurationTypeDescriptor[]> {
  return fetchData<AiAssistantConfigurationTypeDescriptor[]>(
    buildAvailableConfigurationsTypeUrl(params),
    signal ? { signal } : {},
  );
}

/* ── API-146: GET /configurations/configurations/{projectId} (list) ─────── */

/** One row of `getConfigurationsList`'s response — a credential/service-prompt INSTANCE. */
export interface AiAssistantConfigurationWire {
  readonly id?: string | number;
  readonly type: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly elitea_title?: string;
  readonly [key: string]: unknown;
}

export interface AiAssistantConfigurationPageWire {
  readonly items: readonly AiAssistantConfigurationWire[];
  readonly total: number;
  readonly shared?: {
    readonly items: readonly AiAssistantConfigurationWire[];
    readonly total: number;
  };
}

export interface GetConfigurationsListParams {
  readonly projectId: string | number;
  readonly section: string;
  readonly includeShared?: boolean;
  readonly pageSize?: number;
  /**
   * Matches A7's `GetConfigurationsListParams.params` shape
   * (`features/credentials/api/configurations.ts`). Defaults to
   * `{ sort_by: 'created_at', sort_order: 'desc', query: '' }` when
   * omitted, exactly like the baseline RTK Query endpoint's own default
   * argument (`apps/elitea-ui/src/api/configurations.js`'s
   * `getConfigurationsList.query`'s `extraParams` default) — these 3 keys
   * are ALWAYS on the wire, not opt-in.
   */
  readonly params?: {
    readonly sort_by?: string;
    readonly sort_order?: string;
    readonly query?: string;
  };
}

const DEFAULT_PAGE_SIZE = 20;

export function buildConfigurationsListUrl(params: GetConfigurationsListParams): string {
  const { projectId, section, includeShared = false, pageSize = DEFAULT_PAGE_SIZE, params: extra } = params;
  const { sort_by, sort_order, query } = extra ?? { sort_by: 'created_at', sort_order: 'desc', query: '' };
  const search = new URLSearchParams();
  search.append('include_shared', String(includeShared));
  search.append('shared_offset', '0');
  search.append('shared_limit', String(pageSize));
  search.append('limit', String(pageSize));
  search.append('offset', '0');
  if (sort_by !== undefined) search.append('sort_by', sort_by);
  if (sort_order !== undefined) search.append('sort_order', sort_order);
  if (query !== undefined) search.append('query', query);
  search.append('section', section);
  return `/configurations/configurations/${projectId}?${search.toString()}`;
}

export async function getConfigurationsList(
  params: GetConfigurationsListParams,
  signal?: AbortSignal,
): Promise<AiAssistantConfigurationPageWire> {
  return fetchData<AiAssistantConfigurationPageWire>(buildConfigurationsListUrl(params), signal ? { signal } : {});
}
