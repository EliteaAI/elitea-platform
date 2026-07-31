/**
 * Model configuration hook — manages selected model state and auto-selection.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useModelConfiguration.hooks.jsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ModelInfo } from '@/entities/credential/model/types';

import { removeDuplicateModels } from '@/routes/_shell/settings/ai-configuration/modelConfiguration.helpers';

export interface ModelState {
  configuration_uid: string;
  model_name: string;
  configuration_name: string;
  project_id: string;
  integration_name: string;
  [key: string]: unknown;
}

export interface UseModelConfigurationResult {
  model: ModelState;
  selectedModelFromConfigurations: ModelInfo | null;
  onChangeModel: (model: ModelInfo) => void;
}

// ---------------------------------------------------------------------------
// Helper: build model state from a ModelInfo (complexity ≤ 4)
// ---------------------------------------------------------------------------

function buildModelState(modelInfo: ModelInfo): ModelState {
  return {
    configuration_uid: modelInfo.project_id || 'default',
    model_name: modelInfo.name || modelInfo.id,
    configuration_name: `Project ${modelInfo.project_id || 'Default'}`,
    integration_name: modelInfo.integration_name || modelInfo.type || 'OpenAI',
    ...modelInfo,
  };
}

// ---------------------------------------------------------------------------
// Helper: find default or first config (complexity ≤ 3)
function findDefaultOrFirst(models: readonly ModelInfo[]): ModelInfo | null {
  const found = models?.find((c) => c.default);
  return found || models?.[0] || null;
}

/**
 * Check if a model matches a name.
 */
function matchesModelName(model: ModelInfo, name: string): boolean {
  return model.name === name || model.id === name;
}

// Helper: find model by name + project (complexity ≤ 3)
function findModelByNameAndProject(
  models: readonly ModelInfo[],
  name: string,
  projectId: string,
): ModelInfo | undefined {
  return models.find((c) => matchesModelName(c, name) && c.project_id === projectId);
}

// Helper: find model by name only (complexity ≤ 2)
function findModelByName(models: readonly ModelInfo[], name: string): ModelInfo | undefined {
  return models.find((c) => matchesModelName(c, name));
}

// Helper: find model by uid (complexity ≤ 2)
function findModelByUid(models: readonly ModelInfo[], uid: string): ModelInfo | undefined {
  return models.find((c) => c.id === uid || c.name === uid);
}

/**
 * Find a model from unique configurations, trying multiple lookup strategies.
 */
function findSelectedModel(
  uniqueConfigurations: readonly ModelInfo[],
  modelName: string,
  configurationUid: string,
  projectId: string,
): ModelInfo | null {
  if (!modelName) return findDefaultOrFirst(uniqueConfigurations);

  let foundModel = findModelByNameAndProject(uniqueConfigurations, modelName, projectId);
  if (!foundModel) foundModel = findModelByName(uniqueConfigurations, modelName);
  if (!foundModel && configurationUid) foundModel = findModelByUid(uniqueConfigurations, configurationUid);

  if (!foundModel) return null;
  if (!foundModel.name) return { ...foundModel, model_name: foundModel.name || foundModel.id };
  return foundModel;
}

// ---------------------------------------------------------------------------
// Helper: find default model (complexity ≤ 6)
// ---------------------------------------------------------------------------

function findDefaultModel(
  uniqueConfigurations: readonly ModelInfo[],
  projectId: string,
): ModelInfo | null {
  const defaultModelFromProject = uniqueConfigurations.find(
    (m) => m.default && m.project_id === projectId,
  );

  if (defaultModelFromProject) {
    return defaultModelFromProject;
  }

  return (
    uniqueConfigurations.find((m) => m.project_id === projectId) ||
    uniqueConfigurations.find((m) => m.default) ||
    uniqueConfigurations[0] ||
    null
  );
}

// ---------------------------------------------------------------------------
// useModelConfiguration
// ---------------------------------------------------------------------------

export function useModelConfiguration({
  projectId,
  configurations,
}: {
  projectId: string | null;
  configurations: readonly ModelInfo[];
}): UseModelConfigurationResult {
  const [model, setModel] = useState<ModelState>({
    configuration_uid: '',
    model_name: '',
    configuration_name: '',
    project_id: '',
    integration_name: '',
  });

  const [previousProjectId, setPreviousProjectId] = useState<string | null>(projectId);

  // Reset model when project changes
  useEffect(() => {
    if (projectId && previousProjectId && previousProjectId !== projectId) {
      setModel({
        configuration_uid: '',
        model_name: '',
        configuration_name: '',
        project_id: '',
        integration_name: '',
      });
    }
    setPreviousProjectId(projectId);
  }, [projectId, previousProjectId]);

  const uniqueConfigurations = useMemo(() => {
    return removeDuplicateModels(configurations as ModelInfo[]);
  }, [configurations]);

  // Find the selected model from configurations
  const selectedModelFromConfigurations = useMemo(
    () => findSelectedModel(
      uniqueConfigurations,
      model.model_name,
      model.configuration_uid,
      model.project_id,
    ),
    [model.model_name, model.configuration_uid, model.project_id, uniqueConfigurations],
  );

  // Set initial default model
  useEffect(() => {
    if (!selectedModelFromConfigurations) return;
    if (!model.model_name) {
      setModel(buildModelState(selectedModelFromConfigurations));
    }
  }, [model.model_name, selectedModelFromConfigurations]);

  // Auto-select default model on initial load
  useEffect(() => {
    if (!uniqueConfigurations || uniqueConfigurations.length === 0 || !projectId) return;
    if (model.model_name || model.configuration_uid || model.integration_name) return;

    const defaultModel = findDefaultModel(uniqueConfigurations, projectId);
    if (defaultModel) {
      setModel(buildModelState(defaultModel));
    }
  }, [uniqueConfigurations, projectId, model.model_name, model.configuration_uid, model.integration_name]);

  const onChangeModel = useCallback((selectedModel: ModelInfo) => {
    setModel(buildModelState(selectedModel));
  }, []);

  return {
    model,
    selectedModelFromConfigurations,
    onChangeModel,
  };
}

/**
 * Model option creator — produces Select-compatible option arrays.
 */
export const createOptions = (
  items: readonly ModelInfo[] | undefined,
): Array<{ value: string; label: string }> => {
  return (
    items?.map((config) => ({
      value: `${config.name}<<>>${config.project_id}`,
      label: config.display_name || config.name,
    })) || []
  );
};
