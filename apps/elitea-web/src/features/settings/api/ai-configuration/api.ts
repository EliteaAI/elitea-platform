/**
 * Fetcher for GET/POST /configurations/models/{projectId}.
 * Ported from `apps/elitea-ui/src/api/configurations.js`'s `listModels` and
 * `setProjectDefaultModel` RTK Query endpoints. Neither has an OpenAPI
 * entry — shapes observed from request/response.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { ModelInfo } from '@/entities/credential';

const BASE_PATH = '/configurations';

export interface ModelsApiResponse {
  items: readonly ModelInfo[];
  total: number;
  default_model_name: string;
  default_model_project_id: string;
  low_tier_default_model_name: string;
  low_tier_default_model_project_id: string;
  high_tier_default_model_name: string;
  high_tier_default_model_project_id: string;
}

/** Safe default shape — mirrors the old app's `useListModelsQuery` default arg. */
export const EMPTY_MODELS_RESPONSE: ModelsApiResponse = {
  items: [],
  total: 0,
  default_model_name: '',
  default_model_project_id: '',
  low_tier_default_model_name: '',
  low_tier_default_model_project_id: '',
  high_tier_default_model_name: '',
  high_tier_default_model_project_id: '',
};

/**
 * Fetch model list for a project.
 * @param projectId — project UID from the selected project.
 * @param section — one of: `llm`, `embedding`, `vectorstorage`, `image_generation`, `asr`, `tts`.
 * @param includeShared — include shared (public-project) models.
 */
export async function fetchModels(
  projectId: string,
  section: string,
  includeShared: boolean,
): Promise<ModelsApiResponse> {
  const params = new URLSearchParams({
    section,
    include_shared: String(includeShared),
  });

  const response = await window.fetch(`${BASE_PATH}/models/${projectId}?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ModelsApiResponse>;
}

function modelsQueryKey(projectId: string, section: string): readonly unknown[] {
  return ['settings', 'ai-configuration', 'models', projectId, section];
}

/**
 * React Query wrapper around `fetchModels` — mirrors the old app's
 * `useListModelsQuery({ projectId, include_shared, section })`, used to
 * read the project's real configured default model per section (and, for
 * `section: 'llm'`, each model's real `default` flag).
 */
export function useModelsQuery(
  projectId: string,
  section: string,
  includeShared: boolean,
): UseQueryResult<ModelsApiResponse, Error> {
  return useQuery({
    queryKey: modelsQueryKey(projectId, section),
    queryFn: () => fetchModels(projectId, section, includeShared),
    enabled: !!projectId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

export interface SetProjectDefaultModelParams {
  readonly name: string;
  readonly targetProjectId: string;
  /** e.g. `llm`, `llm_low_tier`, `llm_high_tier`, `embedding`, `vectorstorage`, `image_generation`, `asr`, `tts`. */
  readonly section: string;
}

/**
 * Persist the project's default model for a section.
 * Ported from `apps/elitea-ui/src/api/configurations.js`'s
 * `setProjectDefaultModel` RTK Query mutation.
 */
export async function setProjectDefaultModel(
  projectId: string,
  params: SetProjectDefaultModelParams,
): Promise<ModelsApiResponse> {
  const response = await window.fetch(`${BASE_PATH}/models/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      target_project_id: params.targetProjectId,
      section: params.section,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set default model: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ModelsApiResponse>;
}

/**
 * Mutation hook for `setProjectDefaultModel`. Invalidates every cached
 * models query for the project on success so the Select/"Default" badge
 * reflect the new default immediately, mirroring the old app's
 * `invalidatesTags: [TAG_MODELS]`.
 */
export function useSetProjectDefaultModelMutation(
  projectId: string,
): UseMutationResult<ModelsApiResponse, Error, SetProjectDefaultModelParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => setProjectDefaultModel(projectId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'ai-configuration', 'models', projectId] });
    },
    onError: (error) => {
      // Old app: `.catch(error => console.error('Error setting default model:', error))`.
      // eslint-disable-next-line no-console
      console.error('Error setting default model:', error);
    },
  });
}
