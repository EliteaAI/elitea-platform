/**
 * Resolves the default LLM model for the current project.
 *
 * Mirrors the old-app `useDefaultModel` hook
 * (`apps/elitea-ui/src/[fsd]/shared/lib/hooks/useDefaultModel.hooks.js`)
 * which resolves:
 *  1. Model matching `default_model_name` from the API response
 *  2. Model with `default: true` flag
 *  3. First model in the list
 *  4. `null` if no models are available
 *
 * Uses a handwritten `useListModels` hook (not generated) because the
 * models list is served by `/configurations/configurations/{projectId}`
 * with `section=tts` — a configuration query, not a domain endpoint.
 */
import { useMemo } from 'react';

import { useListModelsQuery } from '@/shared/api/configurationsApi';

interface UseDefaultModelOptions {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
  includeShared?: boolean;
  skip?: boolean;
}

export interface UseDefaultModelResult {
  modelList: Array<{
    name: string;
    project_id: string;
    default?: boolean;
    display_name?: string;
  }>;
  defaultModel: {
    name: string;
    project_id: string;
    default?: boolean;
    display_name?: string;
  } | null;
  defaultModelName: string;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

export function useDefaultModel(options: UseDefaultModelOptions): UseDefaultModelResult {
  const { projectId, includeShared = true, skip = false } = options;

  const {
    data: { items: modelList = [], default_model_name: defaultModelName = '' } = {},
    isLoading,
    isFetching,
    isError,
  } = useListModelsQuery(
    { projectId: projectId ?? '', include_shared: includeShared },
    { skip: skip || !projectId },
  );

  const defaultModel = useMemo(() => {
    if (defaultModelName) {
      const foundModel = modelList.find((model) => model.name === defaultModelName);
      if (foundModel) return foundModel;
    }
    return modelList.find((model) => model.default) || modelList[0] || null;
  }, [defaultModelName, modelList]);

  return {
    modelList,
    defaultModel: defaultModel ?? null,
    defaultModelName,
    isLoading,
    isFetching,
    isError,
  };
}
