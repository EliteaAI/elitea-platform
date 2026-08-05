/**
 * Split out of `ChatBox.tsx` to stay under the file-length/component-props
 * budgets (§3.5) — the LLM model list + selection wiring for the chat
 * input's `LLMModelSelector` slot.
 */
import { useCallback, useMemo } from 'react';

import { useListModelsQuery } from '@/shared/api/configurationsApi';

import { toLlmModel } from '../ChatBox.helpers';

type LLMModel = ReturnType<typeof toLlmModel>;

export interface UseChatBoxModelSelectionParams {
  readonly projectId: string | number | undefined;
  readonly selectedModelName: string | undefined;
  readonly setSelectedModel: (model: { readonly name?: string; readonly projectId?: string; readonly supportsReasoning?: boolean } | null) => void;
}

export interface UseChatBoxModelSelectionResult {
  readonly modelsList: readonly LLMModel[];
  readonly selectedLlmModel: LLMModel | null;
  readonly handleSelectModel: (model: LLMModel) => void;
}

export function useChatBoxModelSelection({
  projectId,
  selectedModelName,
  setSelectedModel,
}: UseChatBoxModelSelectionParams): UseChatBoxModelSelectionResult {
  const { data: modelsData } = useListModelsQuery(
    { projectId: projectId !== undefined ? String(projectId) : '', include_shared: true },
    { enabled: projectId !== undefined },
  );
  const modelsList = useMemo(() => (modelsData?.items ?? []).map(toLlmModel), [modelsData?.items]);
  const selectedLlmModel = useMemo(
    () => modelsList.find((m) => m.name === selectedModelName) ?? null,
    [modelsList, selectedModelName],
  );
  const handleSelectModel = useCallback(
    (model: LLMModel) => {
      const raw = modelsData?.items.find((m) => m.name === model.name);
      setSelectedModel(raw ? { name: raw.name, projectId: raw.project_id, supportsReasoning: Boolean(raw['supports_reasoning']) } : { name: model.name });
    },
    [modelsData?.items, setSelectedModel],
  );

  return { modelsList, selectedLlmModel, handleSelectModel };
}
