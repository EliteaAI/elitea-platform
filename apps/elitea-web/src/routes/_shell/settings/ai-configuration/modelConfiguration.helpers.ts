/**
 * Model configuration helpers for the AI Configuration feature.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/modelConfiguration.helpers.js`.
 */

export const removeDuplicateModels = <T extends { id?: string; name?: string; project_id?: string }>(
  models: T[] | undefined,
): T[] => {
  if (!models) return [];
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = `${model?.id || 'unknown'}-${model?.name || 'unknown'}-${model?.project_id || 'default'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getModelCapabilities = (
  options: Record<string, Array<{ value: string; capabilities?: Record<string, boolean> }>>,
  configurationUid: string,
  modelName: string,
): string[] => {
  if (!modelName) return [];

  const groupedOptions = Object.values(options).filter((group) => group.length > 0);
  const foundGroup = groupedOptions.find((groupedOption) => groupedOption[0]?.value === configurationUid);
  const foundOption: Record<string, unknown> = foundGroup?.find((item) => item.value === modelName) || {};

  const capabilityMap: Record<string, string> = {
    chat_completion: 'Chat',
    completion: 'Completion',
    embedding: 'Embeddings',
    embeddings: 'Embeddings',
    reasoning: 'Reasoning',
    code_generation: 'Code Generation',
    function_calling: 'Function Calling',
  };

  const caps = foundOption.capabilities as Record<string, boolean> | undefined;

  return Object.entries(caps || {})
    .filter(([, value]) => value === true)
    .map(([key]) => capabilityMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
};

export const buildConfigurationData = ({
  userApiUrl,
  projectId,
  model,
  configurationsBySections,
  uniqueConfigurations,
}: {
  userApiUrl: string;
  projectId: string;
  model: Record<string, unknown>;
  configurationsBySections: Record<string, Array<Record<string, unknown>>>;
  uniqueConfigurations: Array<Record<string, unknown>>;
}): Record<string, unknown> => {
  let capabilitiesList: string[] = [];

  if (uniqueConfigurations && model.model_name && model.configuration_uid) {
    const configOptions = configurationsToOptions(uniqueConfigurations);
    const groupedOptions = Object.values(configOptions).filter((group) => group.length > 0);
    const foundGroup = groupedOptions.find(
      (groupedOption) => groupedOption[0]?.group === model.configuration_uid,
    );
    const foundOption: Record<string, unknown> = foundGroup?.find((item) => item.value === model.model_name) || {};

    const foundCaps = foundOption.capabilities as Record<string, boolean> | undefined;

    capabilitiesList = Object.entries(foundCaps || {})
      .filter(([, value]) => value === true)
      .map(([key]) => key);
  }

  const extractConfigName = (config: Record<string, unknown>): string => {
    const d = config.data as Record<string, unknown> | undefined;
    return (d?.name as string) ||
    (d?.model as string) ||
    (d?.model_name as string) ||
    (config.title as string) ||
    ((config.settings as Record<string, unknown>)?.title as string) ||
    ((config.config as Record<string, unknown>)?.name as string) ||
    (config.label as string) ||
    (config.elitea_title as string) ||
    (config.name as string) ||
    (config.type as string) ||
    '';
  };

  return {
    project_configuration: {
      server_url: userApiUrl || 'Not configured',
      base_url: userApiUrl ? `${userApiUrl.replace('/api/v2', '')}/llm/v1` : 'Not configured',
      project_id: projectId || 'Not configured',
    },
    configuration_options: {
      model_name: (model.model_name as string) || '',
      configuration_type: (model.configuration_name as string) || '',
      configuration_uid: (model.configuration_uid as string) || '',
    },
    model_capabilities: capabilitiesList,
    available_configurations: {
      llm_models:
        (configurationsBySections.llm || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
      embedding_models:
        (configurationsBySections.embedding || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
      vector_storages:
        (configurationsBySections.vectorstorage || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
      ai_credentials:
        (configurationsBySections.ai_credentials || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
      image_generation_models:
        (configurationsBySections.image_generation || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
      asr_models:
        (configurationsBySections.asr || []).map((config) => ({
          id: config.id,
          name: extractConfigName(config),
          type: config.type,
          shared: config.shared === true,
          project_id: config.project_id,
        })) || [],
    },
  };
};

type ConfigOption = {
  label: string;
  value: string;
  group: string;
  group_name: string;
  capabilities?: Record<string, boolean> | undefined;
  originalModel?: Record<string, unknown>;
};

const configurationsToOptions = (
  configurations: Array<Record<string, unknown>>,
): Record<string, ConfigOption[]> => {
  return (configurations || []).reduce((accumulator: Record<string, ConfigOption[]>, model) => {
    const modelName = (model?.name as string) || `Model ${(model?.id as string) ?? 'Unknown'}`;
    const modelId = (model?.id as string) || (model?.name as string) || 'unknown';
    const groupName = `Project ${(model?.project_id as string) ?? 'Default'}`;
    const groupId = (model?.project_id as string) || 'default';

    if (!accumulator[groupName]) {
      accumulator[groupName] = [];
    }

    const existingModel = accumulator[groupName].find(
      (existingItem) =>
        existingItem.value === modelId ||
        existingItem.label === modelName ||
        (existingItem.originalModel?.id === model?.id && existingItem.originalModel?.name === model?.name),
    );

    if (!existingModel) {
      accumulator[groupName].push({
        label: modelName,
        value: modelId,
        group: groupId,
        group_name: groupName,
        capabilities: model?.capabilities as Record<string, boolean> | undefined,
        originalModel: model,
      });
    }

    return accumulator;
  }, {} as Record<string, ConfigOption[]>);
};
