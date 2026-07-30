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
  const selectedModelFromConfigurations = useMemo(() => {
    if (!model.model_name) {
      return uniqueConfigurations?.find((c) => c.default) || uniqueConfigurations?.[0] || null;
    }

    let foundModel = uniqueConfigurations.find(
      (c) =>
        (c.name === model.model_name || c.id === model.model_name) &&
        c.project_id === model.project_id,
    );

    if (!foundModel && model.model_name) {
      foundModel = uniqueConfigurations.find(
        (c) => c.name === model.model_name || c.id === model.model_name,
      );
    }

    if (!foundModel && model.configuration_uid) {
      foundModel = uniqueConfigurations.find(
        (c) => c.id === model.configuration_uid || c.name === model.configuration_uid,
      );
    }

    if (foundModel && !foundModel.name) {
      return {
        ...foundModel,
        model_name: foundModel.name || foundModel.id,
      };
    }

    return foundModel || null;
  }, [model.model_name, model.configuration_uid, model.project_id, uniqueConfigurations]);

  // Set initial default model
  useEffect(() => {
    if (!selectedModelFromConfigurations) return;

    if (!model.model_name) {
      setModel({
        configuration_uid: selectedModelFromConfigurations?.project_id || 'default',
        model_name: selectedModelFromConfigurations?.name || selectedModelFromConfigurations.id,
        configuration_name: `Project ${selectedModelFromConfigurations?.project_id || 'Default'}`,
        integration_name:
          selectedModelFromConfigurations?.integration_name ||
          selectedModelFromConfigurations?.type ||
          'OpenAI',
        ...selectedModelFromConfigurations,
      });
    }
  }, [model.model_name, selectedModelFromConfigurations]);

  // Auto-select default model on initial load
  useEffect(() => {
    if (!uniqueConfigurations || uniqueConfigurations.length === 0 || !projectId) return;

    const hasAnyModelData = model.model_name || model.configuration_uid || model.integration_name;
    if (hasAnyModelData) return;

    let defaultModel: ModelInfo | null = null;

    const defaultModelFromProject = uniqueConfigurations.find(
      (m) => m.default === true && m.project_id === projectId,
    );

    if (defaultModelFromProject) {
      defaultModel = defaultModelFromProject;
    } else {
      defaultModel =
        uniqueConfigurations.find((m) => m.project_id === projectId) ||
        uniqueConfigurations.find((m) => m.default === true) ||
        uniqueConfigurations[0] ||
        null;
    }

    if (defaultModel) {
      setModel({
        configuration_uid: defaultModel.project_id || 'default',
        model_name: defaultModel.name || defaultModel.id,
        configuration_name: `Project ${defaultModel.project_id || 'Default'}`,
        integration_name: defaultModel.integration_name || defaultModel.type || 'OpenAI',
        ...defaultModel,
      });
    }
  }, [uniqueConfigurations, projectId, model.model_name, model.configuration_uid, model.integration_name]);

  const onChangeModel = useCallback((selectedModel: ModelInfo) => {
    const updatedModel: ModelState = {
      configuration_uid: selectedModel.project_id || 'default',
      model_name: selectedModel.name || selectedModel.id,
      configuration_name: `Project ${selectedModel.project_id || 'Default'}`,
      integration_name: selectedModel.integration_name || selectedModel.type || 'OpenAI',
      ...selectedModel,
    };

    setModel(updatedModel);
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
