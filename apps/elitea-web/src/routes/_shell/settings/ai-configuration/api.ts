/**
 * Fetcher for GET /configurations/models/{projectId}.
 * Ported from `apps/elitea-ui/src/api/configurations.js`'s `listModels` RTK Query endpoint.
 * The endpoint has no OpenAPI entry — shape observed from request/response.
 */
import type { ModelInfo } from '@/entities/credential/model/types';

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
