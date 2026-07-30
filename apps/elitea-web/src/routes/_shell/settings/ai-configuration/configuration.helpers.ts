/**
 * Configuration helpers for the AI Configuration feature.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/configuration.helpers.js`
 * and `apps/elitea-ui/src/[fsd]/features/settings/lib/constants/configuration.constants.js`.
 */

const ICON_TYPE_KEYS: Record<string, readonly string[]> = {
  VERTEX_AI: ['vertex_ai', 'vertexai'],
  AI_DIAL: ['ai_dial', 'dial'],
  OPEN_AI: ['open_ai', 'openai', 'gpt', 'codex mini', 'embedding-ada', 'whisper'],
  CLAUDE: ['claude', 'anthropic', 'opus', 'haiku'],
  OLLAMA: ['ollama'],
  AMAZON_BEDROCK: ['amazon_bedrock'],
  AMAZON: ['amazon.titan'],
  HUGGING_FACE: ['hugging_face', 'huggingface'],
  CHROMA: ['chroma'],
  AZURE: ['open_ai_azure', 'azure', 'azure_openai', 'azure_open_ai', 'model-router'],
  PGVECTOR: ['pgvector', 'postgresql', 'postgres'],
};

export const CONFIGURATION_TYPE_GROUPS = {
  OpenAI: {
    label: 'OpenAI',
    types: ['open_ai', 'openai', 'gpt', 'codex mini', 'embedding-ada'],
  },
  Anthropic: {
    label: 'Anthropic',
    types: ['claude', 'anthropic', 'opus', 'haiku'],
  },
  OtherLLMProviders: {
    label: 'Other LLM Providers',
    types: [
      'vertex_ai',
      'vertexai',
      'ai_dial',
      'dial',
      'ollama',
      'amazon_bedrock',
      'amazon.titan',
      'hugging_face',
      'huggingface',
      'chroma',
      'open_ai_azure',
      'azure',
      'azure_openai',
      'azure_open_ai',
      'model-router',
      'pgvector',
      'postgresql',
      'postgres',
    ],
  },
} as const;

const ICON_TYPE_KEYS_ARRAY: readonly { key: string; values: readonly string[] }[] = Object.entries(ICON_TYPE_KEYS)
  .map(([key, values]) => ({ key, values }) as { key: string; values: readonly string[] })
  .sort((a, b) => b.values.length - a.values.length);

export const getIconTypeKey = (name: string | undefined, type: string | undefined, label: string | undefined): string => {
  const iconKey = ((name || type || '') as string).toLowerCase();

  for (const { key, values } of ICON_TYPE_KEYS_ARRAY) {
    if (values.includes(iconKey)) return key;
    if (label && values.some((keyword) => label.toLowerCase().includes(keyword))) return key;
  }

  return 'DEFAULT';
};

const getCfgData = (cfg: Record<string, unknown>): Record<string, unknown> | undefined => {
  return cfg.data as Record<string, unknown> | undefined;
};

const extractField = (
  cfg: Record<string, unknown>,
  ...keys: Array<keyof Record<string, unknown> | keyof (Record<string, unknown> & { data?: Record<string, unknown> } & { settings?: Record<string, unknown> } & { config?: Record<string, unknown> } & { metadata?: Record<string, unknown> })>
): string | undefined => {
  for (const key of keys) {
    const value = cfg[key];
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      return String(value);
    }
  }
  const data = getCfgData(cfg);
  if (data) {
    for (const key of keys) {
      const value = data[key];
      if (value !== undefined && value !== null && String(value).trim().length > 0) {
        return String(value);
      }
    }
  }
  const settings = cfg.settings as Record<string, unknown> | undefined;
  if (settings) {
    const val = settings.title;
    if (val !== undefined && String(val).trim().length > 0) return String(val);
  }
  const config = cfg.config as Record<string, unknown> | undefined;
  if (config) {
    const val = config.name;
    if (val !== undefined && String(val).trim().length > 0) return String(val);
  }
  const metadata = cfg.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const title = metadata.title;
    if (title !== undefined && String(title).trim().length > 0) return String(title);
    const name = metadata.name;
    if (name !== undefined && String(name).trim().length > 0) return String(name);
  }
  return undefined;
};

export const getConfigurationDisplayName = (configuration: Record<string, unknown>): string => {
  const rawName =
    (configuration.label as string | undefined) ||
    extractField(configuration, 'name', 'model', 'model_name' as never, 'title', 'elitea_title' as never, 'name' as never) ||
    (configuration.name as string | undefined) ||
    (configuration.elitea_title as string | undefined);

  if (rawName && String(rawName).trim().length > 0) {
    return rawName;
  }

  if (configuration.type) {
    return (configuration.type as string)
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return 'Unnamed Configuration';
};

export const getConfigurationStatus = (statusOk: boolean, isShared: boolean): string => {
  const status = statusOk ? 'OK' : 'In Progress';
  const scope = isShared ? 'Shared' : 'Local';
  return `${status} \u2022 ${scope}`;
};

export const isConfigurationEditable = (configuration: Record<string, unknown>, projectId: string, canEdit: boolean): boolean => {
  const configProjectId = configuration.project_id as string | undefined;
  if (configProjectId === projectId) {
    return canEdit;
  }
  return false;
};

export const getConfigurationGroup = (
  name: string | undefined,
  type: string | undefined,
  label: string | undefined,
): string => {
  const configKey = ((name || type || '') as string).toLowerCase();
  const labelKey = ((label || '') as string).toLowerCase();

  const thirdPartyHostingKeywords = [
    'azure',
    'bedrock',
    'vertex',
    'vertexai',
    'dial',
    'ai_dial',
    'ollama',
    'hugging',
    'model-router',
    'postgres',
  ];

  const isThirdPartyHosted = thirdPartyHostingKeywords.some(
    (keyword) => configKey.includes(keyword) || labelKey.includes(keyword),
  );

  if (isThirdPartyHosted) {
    return CONFIGURATION_TYPE_GROUPS.OtherLLMProviders.label;
  }

  if (
    CONFIGURATION_TYPE_GROUPS.OpenAI.types.some(
      (typeStr) => typeStr.toLowerCase() === configKey || configKey.includes(typeStr.toLowerCase()),
    )
  ) {
    return CONFIGURATION_TYPE_GROUPS.OpenAI.label;
  }
  if (
    labelKey &&
    CONFIGURATION_TYPE_GROUPS.OpenAI.types.some((typeStr) => labelKey.includes(typeStr.toLowerCase()))
  ) {
    return CONFIGURATION_TYPE_GROUPS.OpenAI.label;
  }

  if (
    CONFIGURATION_TYPE_GROUPS.Anthropic.types.some(
      (typeStr) => typeStr.toLowerCase() === configKey || configKey.includes(typeStr.toLowerCase()),
    )
  ) {
    return CONFIGURATION_TYPE_GROUPS.Anthropic.label;
  }
  if (
    labelKey &&
    CONFIGURATION_TYPE_GROUPS.Anthropic.types.some((typeStr) => labelKey.includes(typeStr.toLowerCase()))
  ) {
    return CONFIGURATION_TYPE_GROUPS.Anthropic.label;
  }

  return CONFIGURATION_TYPE_GROUPS.OtherLLMProviders.label;
};

export const sortConfigurationsByDisplayName = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number => {
  const nameA = getConfigurationDisplayName(a).toLowerCase();
  const nameB = getConfigurationDisplayName(b).toLowerCase();
  return nameA.localeCompare(nameB);
};

/**
 * Build model options for a Select component from configurations.
 */
export const createConfigurationOptions = (
  configurations: readonly Record<string, unknown>[],
  iconRenderer?: (projectId: string) => React.ReactNode,
) => {
  return (
    configurations
      ?.map((config) => ({
        value: `${(config.name as string) ?? ''}<<>>${config.project_id}`,
        label: (config.display_name as string | undefined) || (config.name as string) || '',
        icon: iconRenderer ? iconRenderer(config.project_id as string) : undefined,
      })) || []
  );
};
