/**
 * The four evaluation dimension-library calls.
 *
 * The baseline's `evaluationApi.js` declares 38 operations over 19 `eval_*`
 * path families. Four of them are here, because four of them exist on the
 * server: `GET`/`POST /elitea_core/eval_dimensions/prompt_lib/{projectId}` and
 * `PUT`/`DELETE /elitea_core/eval_dimension/prompt_lib/{projectId}/{id}`
 * (`internal/api/router.go`). The suite, binding, dataset, case, run, result,
 * human-score, platform-catalogue and generate-dimensions families are NOT
 * declared here: calling a route this deployment does not serve produces a 404
 * the user reads as a broken page.
 *
 * R-A5 DEBT, STATED RATHER THAN HIDDEN. These four calls are NOT in
 * `shared/api/endpoints.manifest.json`, and R-A5 says every network call
 * belongs there. They were added and then withdrawn, because the manifest is
 * the input to a second gate that this slice cannot satisfy:
 * elitea-main's `TestSpecRouterConformance/manifest_reverse_check` requires
 * every manifest endpoint to be described in `api/openapi/v2.yaml`, or to be
 * listed in `internal/api/oapiserver/testdata/reverse_check_allowlist.txt` —
 * and that allowlist is at its pinned maximum (94 of 94) and "may only shrink".
 *
 * So the manifest entry is blocked on the spec entry, and the spec is
 * deliberately untouched here: editing `v2.yaml` ripples through two codegens
 * and several pinned gates, and it is owned by another stream. The four
 * operations owed to the spec are exactly the routes named above. When they
 * land in `v2.yaml`, add the matching manifest entries — ids
 * `evaluation.{list,create,update,delete}Dimension`, `source: 'handwritten'`,
 * `usedBy: ['features/agent-evaluation']` — and this paragraph goes away.
 *
 * Nothing here is silently degraded by the gap: the calls work, and
 * `evaluationApi.test.ts` covers each of them against a mocked server.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapList } from '@/shared/api/unwrap';

import type { EvalDimension, EvalDimensionWriteInput } from '../model/types';

/**
 * `eliteaFetch` resolves the TRANSPORT envelope `{data, status, headers}`, and
 * its `as T` cast will happily let a caller type it as the response body — at
 * which point every field reads `undefined` on a perfectly good 200 (#132).
 * One helper, so no call site in this module can make that mistake.
 */
interface TransportEnvelope<T> {
  readonly data: T;
}

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<TransportEnvelope<T>>(url, options);
  return envelope.data;
}

function jsonOptions(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export interface ListDimensionsOptions {
  /** Narrows the ad-hoc half of the library to ONE agent's own dimensions. */
  readonly applicationId?: number;
  /** Whether platform-tier rows are included. Defaults to true, as the baseline does. */
  readonly includePlatform?: boolean;
}

export async function fetchEvalDimensions(
  projectId: string,
  options: ListDimensionsOptions = {},
): Promise<EvalDimension[]> {
  const params = new URLSearchParams();
  params.set('include_platform', String(options.includePlatform ?? true));
  if (options.applicationId !== undefined) params.set('agent_id', String(options.applicationId));

  const wire = await fetchData<unknown>(
    `/elitea_core/eval_dimensions/prompt_lib/${projectId}?${params.toString()}`,
  );
  // The server answers `{rows, total}`. It goes through `unwrapList` anyway:
  // that is the one sanctioned unwrap in this app (R-A6), it accepts all three
  // envelopes this API serves, and it is LOUD on a fourth — where hardcoding
  // `.rows` would render an empty library behind a 200 with nothing in the
  // console, which is exactly the shape #132 catalogues.
  return unwrapList<EvalDimension>(wire, 'fetchEvalDimensions');
}

export function createEvalDimension(
  projectId: string,
  input: EvalDimensionWriteInput,
): Promise<EvalDimension> {
  return fetchData<EvalDimension>(
    `/elitea_core/eval_dimensions/prompt_lib/${projectId}`,
    jsonOptions('POST', input),
  );
}

export function updateEvalDimension(
  projectId: string,
  dimensionId: string,
  input: EvalDimensionWriteInput,
): Promise<EvalDimension> {
  return fetchData<EvalDimension>(
    `/elitea_core/eval_dimension/prompt_lib/${projectId}/${dimensionId}`,
    jsonOptions('PUT', input),
  );
}

export async function deleteEvalDimension(projectId: string, dimensionId: string): Promise<void> {
  await eliteaFetch<unknown>(`/elitea_core/eval_dimension/prompt_lib/${projectId}/${dimensionId}`, {
    method: 'DELETE',
  });
}
