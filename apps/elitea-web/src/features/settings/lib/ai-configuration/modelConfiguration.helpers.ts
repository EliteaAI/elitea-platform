/**
 * Model configuration helpers for the AI Configuration feature.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/modelConfiguration.helpers.js`.
 */
import { toAbsoluteApiUrl, toOpenAiBaseUrl } from '@/shared/lib/api-url';


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
    .filter(([, value]) => value)
    .map(([key]) => capabilityMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
};

type ConfigOption = {
  label: string;
  value: string;
  group: string;
  group_name: string;
  capabilities?: Record<string, boolean> | undefined;
  originalModel?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// extractConfigName — extracted from buildConfigurationData
// ---------------------------------------------------------------------------

/**
 * Returns the first non-empty string value from the given keys,
 * falling back to the top-level keys on the config object.
 */
function firstNonEmpty(config: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = config[key] as string | undefined;
    if (val) return val;
  }
  return '';
}

/**
 * Extracts a human-readable name from a configuration object,
 * checking multiple possible field names in priority order.
 */
const extractConfigName = (config: Record<string, unknown>): string => {
  const d = config.data as Record<string, unknown> | undefined;
  const cfgSettings = config.settings as Record<string, unknown> | undefined;
  const cfgConfig = config.config as Record<string, unknown> | undefined;
  const pick = (obj: Record<string, unknown> | undefined, key: string): string | undefined =>
    obj?.[key] as string | undefined;
  const keys = ['name', 'model', 'model_name', 'title', 'label', 'elitea_title', 'type'];
  const top = firstNonEmpty(d ?? config, keys);
  return top
    || pick(cfgSettings, 'title')
    || pick(cfgConfig, 'name')
    || '';
};

// ---------------------------------------------------------------------------
// extractCapabilities — extracted from buildConfigurationData
// ---------------------------------------------------------------------------

/**
 * Extracts the capability key list from a model's configuration options.
 */
const extractCapabilities = (
  model: Record<string, unknown>,
  configOptions: Record<string, ConfigOption[]>,
): string[] => {
  const groupedOptions = Object.values(configOptions).filter((g) => g.length > 0);
  const foundGroup = groupedOptions.find(
    (g) => g[0]?.group === model.configuration_uid,
  );
  const foundOption: Record<string, unknown> =
    foundGroup?.find((item) => item.value === model.model_name) || {};

  const caps = foundOption.capabilities as Record<string, boolean> | undefined;
  return Object.entries(caps || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
};

// ---------------------------------------------------------------------------
// mapConfigToList — extracted from buildConfigurationData
// ---------------------------------------------------------------------------

/**
 * Maps a section's configurations to a flat list of summary objects.
 */
const mapConfigToList = (
  section: Array<Record<string, unknown>> | undefined,
): Array<{
  id: unknown;
  name: string;
  type: unknown;
  shared: boolean;
  project_id: unknown;
}> => {
  return (section || []).map((config) => ({
    id: config.id,
    name: extractConfigName(config),
    type: config.type,
    shared: config.shared === true,
    project_id: config.project_id,
  }));
};

// ---------------------------------------------------------------------------
// configurationsToOptions — convert raw configs to grouped options
// ---------------------------------------------------------------------------

/**
 * Converts a flat list of configurations into a record grouped by
 * configuration_uid, suitable for extractCapabilities.
 */
const configurationsToOptions = (
  configs: Array<Record<string, unknown>>,
): Record<string, ConfigOption[]> => {
  const grouped: Record<string, ConfigOption[]> = {};
  for (const cfg of configs) {
    const uid = cfg.configuration_uid as string | undefined;
    if (!uid) continue;
    const option: ConfigOption = {
      label: (cfg.display_name as string | undefined) ||
        (cfg.elitea_title as string) ||
        (cfg.name as string) ||
        (cfg.label as string) ||
        '',
      value: cfg.configuration_uid as string,
      group: cfg.configuration_uid as string,
      group_name: cfg.configuration_name as string || '',
      originalModel: cfg,
    };
    if (!grouped[uid]) grouped[uid] = [];
    grouped[uid].push(option);
  }
  return grouped;
};

// ---------------------------------------------------------------------------
// buildConfigurationData — orchestrator (complexity ≤ 8)
// ---------------------------------------------------------------------------

/**
 * Builds a data object for display from model and configuration data.
 */
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
    capabilitiesList = extractCapabilities(model, configOptions);
  }

  return {
    project_configuration: {
      // Absolute, not relative: these two land inside a generated SDK snippet
      // the user copies out of the browser, where a bare `/api/v2` path
      // addresses nothing. See `shared/lib/api-url.ts`.
      server_url: userApiUrl ? toAbsoluteApiUrl(userApiUrl) : 'Not configured',
      base_url: userApiUrl ? toOpenAiBaseUrl(userApiUrl) : 'Not configured',
      project_id: projectId || 'Not configured',
    },
    configuration_options: {
      model_name: (model.model_name as string) || '',
      configuration_type: (model.configuration_name as string) || '',
      configuration_uid: (model.configuration_uid as string) || '',
    },
    model_capabilities: capabilitiesList,
    available_configurations: {
      llm_models: mapConfigToList(configurationsBySections.llm),
      embedding_models: mapConfigToList(configurationsBySections.embedding),
      vector_storages: mapConfigToList(configurationsBySections.vectorstorage),
      ai_credentials: mapConfigToList(configurationsBySections.ai_credentials),
      image_generation_models: mapConfigToList(configurationsBySections.image_generation),
      asr_models: mapConfigToList(configurationsBySections.asr),
    },
  };
};
