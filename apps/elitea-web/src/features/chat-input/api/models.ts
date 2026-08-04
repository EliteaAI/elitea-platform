/**
 * `GET /configurations/models/{projectId}?section={asr|tts}&include_shared=true`
 * — parameterized by `section` per this unit's own build brief: "whichever
 * of you [ASR / voice-tts-config] actually needs it first should build one
 * shared local fetcher... in THIS unit's own api/ layer, parameterized by
 * section, rather than each building a separate near-duplicate." This is
 * that fetcher (ASR built it first — no `features/chat-input/api/models.ts`
 * existed yet as of this unit's build); `section: 'tts'` is ready for the
 * sibling voice-tts-config cluster to call directly (same slice, so a plain
 * relative import needs no barrel entry) instead of writing its own copy.
 *
 * Near-duplicate, disclosed: `features/credentials/api/
 * configurationConnections.ts`'s `listModels`/`ModelList` cover the exact
 * same route already, but `no-sideways-features` forbids importing a
 * `features/credentials` internal from `features/chat-input`, and no
 * shared/entities model-listing primitive exists yet (same class of gap
 * `features/chat-input/api/useSelectedProjectId.ts` documents for "selected
 * project id" — every feature that needs a primitive like this gets a local
 * copy until one is promoted). This unit's report asks for
 * `features/chat-input` to be added to the existing `credentials.listModels`
 * manifest entry's `usedBy` array rather than a new entry — same route,
 * same shape.
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

// Not exported (knip: no outside consumer by name — callers pass the
// literal `'asr'`/`'tts'` string, which satisfies `ListModelsParams`/
// `UseModelsListParams`'s `section` field structurally).
type ModelSection = 'asr' | 'tts';

/** A model row as consumed by callers — `id` is synthesized (see {@link withModelId}); the backend response carries none (`configurations.js:434-438` parity). */
export interface ModelListItem {
  readonly id: string;
  readonly name: string;
  readonly project_id?: string | number;
  readonly default?: boolean;
  readonly [key: string]: unknown;
}

interface ModelListItemWire {
  readonly name: string;
  readonly project_id?: string | number;
  readonly default?: boolean;
  readonly [key: string]: unknown;
}

export interface ModelListResult {
  readonly items: readonly ModelListItem[];
  readonly total: number;
  readonly default_model_name?: string;
  readonly default_model_project_id?: string;
}

interface ModelListWire {
  readonly items?: readonly ModelListItemWire[];
  readonly total: number;
  readonly default_model_name?: string;
  readonly default_model_project_id?: string;
}

// Deliberately NOT `row.project_id ?? ''`: the baseline
// (`configurations.js:434-438`) builds this id via bare template-literal
// coercion of `i.project_id`, so a missing `project_id` yields the literal
// string `"undefined_<name>"`, not an empty-prefixed `"_<name>"`. Matched
// here for byte-for-byte parity even though it reads oddly.
function withModelId(row: ModelListItemWire): ModelListItem {
  return { ...row, id: `${row.project_id}_${row.name}` };
}

export interface ListModelsParams {
  readonly projectId: string;
  readonly section: ModelSection;
  readonly includeShared?: boolean | undefined;
}

export async function listModels(params: ListModelsParams, signal?: AbortSignal): Promise<ModelListResult> {
  const search = new URLSearchParams();
  search.set('include_shared', String(params.includeShared ?? false));
  search.set('section', params.section);
  const response = await fetchData<ModelListWire>(
    `/configurations/models/${params.projectId}?${search.toString()}`,
    signal ? { signal } : {},
  );
  return { ...response, items: (response.items ?? []).map(withModelId) };
}

export interface UseModelsListParams {
  readonly projectId: string | undefined;
  readonly section: ModelSection;
  readonly includeShared?: boolean;
}

export function useModelsList(
  params: UseModelsListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ModelListResult> {
  const { projectId, section, includeShared } = params;
  return useQuery({
    queryKey: ['chat-input', 'models', projectId, section, includeShared],
    queryFn: ({ signal }) => listModels({ projectId: projectId as string, section, includeShared }, signal),
    enabled: (options.enabled ?? true) && projectId !== undefined,
  });
}
