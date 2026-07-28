/**
 * `features/toolkits/api/configurations.ts` — hand-registered fetchers for
 * exactly the four `/configurations/*` operations `ToolkitForm.tsx`/
 * `ToolkitsOperationButtons.tsx` need (`GET .../configurations/{projectId}`
 * (list, for the "does this toolkit type support a saved configuration"
 * check), `POST .../configurations/{projectId}` (create),
 * `POST .../check_connection/{projectId}/{configType}` (test connection),
 * `GET .../available/` (the per-type `config_schema` catalogue
 * `useCreateConfiguration`'s `configurationsAsSchema` param needs, replacing
 * the baseline `useGetCurrentConfigurationAsSchemas`'s Redux-selector read
 * with `../model/useConfigurationsAsSchema.hooks.ts`'s TanStack Query one).
 *
 * **Duplicated, not imported, from `features/credentials/api/
 * configurations.ts`** (which already implements the FULL `/configurations/*`
 * surface, API-145..160) — `no-sideways-features` forbids `features/toolkits`
 * importing `features/credentials`. Same per-slice-duplication convention
 * this session has used repeatedly (`features/agents/api/configurations.ts`
 * duplicates the same two `createConfiguration`/`testConfigurationConnection`
 * fetchers for the identical reason); this unit additionally needs
 * `getConfigurationsList` (API-146), which `features/agents/api/
 * configurations.ts` does not — pulled in fresh from the credentials unit's
 * file rather than a second, three-way duplication chain. Body/URL/query
 * shapes copied byte-for-byte from that file (which itself cites
 * `apps/elitea-ui/src/api/configurations.js`); this unit adds
 * `"features/toolkits"` to `credentials.createConfiguration`/
 * `credentials.testConfigurationConnection`/`credentials.getConfigurationsList`'s
 * `usedBy` arrays in `endpoints.manifest.json` (the manifest's own append
 * convention) rather than registering duplicate ids for the same wire
 * endpoints.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

export interface ConfigurationWire {
  readonly id?: string | number;
  readonly uid?: string;
  readonly type: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly elitea_title?: string;
  readonly label?: string;
  readonly project_id?: string | number;
  readonly [key: string]: unknown;
}

export interface CreateConfigurationBody {
  readonly elitea_title: string;
  readonly label?: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** API-149 (`credentials.createConfiguration`). */
export async function createConfiguration(
  projectId: string | number,
  body: CreateConfigurationBody,
): Promise<ConfigurationWire> {
  return fetchData<ConfigurationWire>(`/configurations/configurations/${projectId}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface TestConnectionResult {
  readonly error?: string;
  readonly tools?: readonly unknown[];
  readonly requires_authorization?: boolean;
  readonly auth_metadata?: unknown;
  readonly [key: string]: unknown;
}

/** API-154 (`credentials.testConfigurationConnection`). */
export async function testConfigurationConnection(
  projectId: string | number,
  configType: string,
  body: Readonly<Record<string, unknown>>,
): Promise<TestConnectionResult> {
  return fetchData<TestConnectionResult>(`/configurations/check_connection/${projectId}/${configType}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface ConfigurationPageWire {
  readonly items: readonly ConfigurationWire[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface GetConfigurationsListParams {
  readonly projectId: string | number;
  readonly section?: string;
}

const DEFAULT_PAGE_SIZE = 20;

/** API-146 (`credentials.getConfigurationsList`), narrowed to the one param combination this unit's callers use (`section` only — no pagination/type/sort). */
export function buildConfigurationsListUrl({ projectId, section }: GetConfigurationsListParams): string {
  const search = new URLSearchParams();
  search.append('include_shared', 'false');
  search.append('shared_offset', '0');
  search.append('shared_limit', String(DEFAULT_PAGE_SIZE));
  search.append('limit', String(DEFAULT_PAGE_SIZE));
  search.append('offset', '0');
  if (section !== undefined) search.append('section', section);
  return `/configurations/configurations/${projectId}?${search.toString()}`;
}

export async function getConfigurationsList(
  params: GetConfigurationsListParams,
  signal?: AbortSignal,
): Promise<ConfigurationPageWire> {
  return fetchData<ConfigurationPageWire>(buildConfigurationsListUrl(params), signal ? { signal } : {});
}

/** One row of `getAvailableConfigurationsType`'s response — a credential-TYPE descriptor (config_schema), not an instance. Needed for `useCreateConfiguration`'s `configurationsAsSchema` param. */
export interface ConfigurationTypeDescriptor {
  readonly type: string;
  readonly title?: string;
  readonly section?: string;
  readonly config_schema?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface GetAvailableConfigurationsTypeParams {
  readonly section?: readonly string[];
}

/** API-145 (`credentials.getAvailableConfigurationsType`). */
export function buildAvailableConfigurationsTypeUrl(params: GetAvailableConfigurationsTypeParams = {}): string {
  const query = new URLSearchParams();
  for (const section of params.section ?? []) query.append('section', section);
  return `/configurations/available/?${query.toString()}`;
}

export async function getAvailableConfigurationsType(
  params: GetAvailableConfigurationsTypeParams = {},
  signal?: AbortSignal,
): Promise<readonly ConfigurationTypeDescriptor[]> {
  return fetchData<readonly ConfigurationTypeDescriptor[]>(buildAvailableConfigurationsTypeUrl(params), signal ? { signal } : {});
}
