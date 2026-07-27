/**
 * features/credentials/api/configurationConnections.ts — the connection
 * test / sharing-toggle / model / type-catalogue endpoints (API-154..160),
 * split out of `./configurations.ts` purely to keep that file under the
 * §3.5 400-line file-length budget. Same hand-registered-endpoint rationale
 * as that file's own doc comment (see there for the full R-A5 account);
 * goes through that file's `fetchData` (itself the one caller of
 * `eliteaFetch`), never raw `fetch` (R-A1 untouched).
 */
import { fetchData, withSignal } from './configurations';
import type { ConfigurationWire } from './configurations';

/* ── shared model-row shaping (API-157/159) ──────────────────────────────── */

interface ModelRowWire {
  readonly name: string;
  readonly project_id?: string | number;
  readonly [key: string]: unknown;
}

interface ModelListWire {
  readonly items: readonly ModelRowWire[];
  readonly total: number;
  readonly default_model_name?: string;
  readonly default_model_project_id?: string;
}

/** `configurations.js:434-438`/`:455-456` — both `listModels` and `setProjectDefaultModel` synthesize `id = \`${project_id}_${name}\`` since the endpoint returns none. */
interface ModelRow extends ModelRowWire {
  readonly id: string;
}

export interface ModelList {
  readonly items: readonly ModelRow[];
  readonly total: number;
  readonly default_model_name?: string;
  readonly default_model_project_id?: string;
}

/** `configurations.js:434-438` — synthesizes the missing row id. */
function withModelId(row: ModelRowWire): ModelRow {
  return { ...row, id: `${row.project_id ?? ''}_${row.name}` };
}

/* ── API-154: POST /configurations/check_connection/{projectId}/{configType} ── */

export async function testConfigurationConnection(
  projectId: string | number,
  configType: string,
  body: Readonly<Record<string, unknown>>,
): Promise<{ readonly error?: string } & Record<string, unknown>> {
  return fetchData(`/configurations/check_connection/${projectId}/${configType}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ── API-155: POST /configurations/check_connections/{projectId} ────────── */

export interface BatchTestConnectionItem {
  readonly id: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface BatchTestResultRow {
  readonly id: string;
  readonly success?: boolean;
  readonly message?: string;
  readonly unsupported?: boolean;
}

export async function batchTestConfigurationConnection(
  projectId: string | number,
  items: readonly BatchTestConnectionItem[],
): Promise<BatchTestResultRow[]> {
  return fetchData<BatchTestResultRow[]>(`/configurations/check_connections/${projectId}`, {
    method: 'POST',
    body: JSON.stringify(items),
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ── API-156: PUT /configurations/configuration/{projectId}/{configId} (share toggle) ── */

export async function toggleConfigurationSharing(
  projectId: string | number,
  configId: string | number,
  shared: boolean,
): Promise<ConfigurationWire> {
  return fetchData<ConfigurationWire>(`/configurations/configuration/${projectId}/${configId}`, {
    method: 'PUT',
    body: JSON.stringify({ shared }),
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ── API-157: GET /configurations/models/{projectId} ─────────────────────── */

export async function listModels(
  projectId: string | number,
  options: { readonly include_shared?: boolean; readonly section?: string } = {},
  signal?: AbortSignal,
): Promise<ModelList> {
  const search = new URLSearchParams();
  search.append('include_shared', String(options.include_shared ?? false));
  if (options.section !== undefined) search.append('section', options.section);
  const response = await fetchData<ModelListWire>(
    `/configurations/models/${projectId}?${search.toString()}`,
    withSignal(signal),
  );
  return { ...response, items: (response.items ?? []).map(withModelId) };
}

/* ── API-158: GET /configurations/types/{projectId} ──────────────────────── */

export interface CredentialTypesResponse {
  readonly rows: readonly string[];
}

export async function listCredentialTypes(
  projectId: string | number,
  signal?: AbortSignal,
): Promise<CredentialTypesResponse> {
  return fetchData<CredentialTypesResponse>(`/configurations/types/${projectId}`, withSignal(signal));
}

/* ── API-159: POST /configurations/models/{projectId} ─────────────────────── */

export interface SetProjectDefaultModelParams {
  readonly projectId: string | number;
  readonly name: string;
  readonly target_project_id: string | number;
  readonly section?: string;
}

export async function setProjectDefaultModel(params: SetProjectDefaultModelParams): Promise<ModelList> {
  const { projectId, name, target_project_id, section = 'llm' } = params;
  const response = await fetchData<ModelListWire>(`/configurations/models/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({ name, target_project_id, section }),
    headers: { 'Content-Type': 'application/json' },
  });
  return { ...response, items: (response.items ?? []).map(withModelId) };
}

/* ── API-160: GET /configurations/tts_voices/{projectId} ─────────────────── */

export async function getTtsVoices(
  projectId: string | number,
  modelName: string | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  const search = new URLSearchParams();
  if (modelName !== undefined) search.append('model_name', modelName);
  return fetchData(`/configurations/tts_voices/${projectId}?${search.toString()}`, withSignal(signal));
}
