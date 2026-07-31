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
  .map(([key, values]) => ({ key, values }))
  .sort((a, b) => b.values.length - a.values.length);

const THIRD_PARTY_HOSTING_KEYWORDS = [
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

const OPENAI_GROUP_TYPES = CONFIGURATION_TYPE_GROUPS.OpenAI.types;
const ANTHROPIC_GROUP_TYPES = CONFIGURATION_TYPE_GROUPS.Anthropic.types;
const OTHER_GROUP_LABEL = CONFIGURATION_TYPE_GROUPS.OtherLLMProviders.label;

/**
 * Checks if a key/label string matches any keyword in a group's type list.
 */
function matchesGroupTypes(
  text: string,
  types: readonly string[],
): boolean {
  return types.some(
    (t) => t.toLowerCase() === text || text.includes(t.toLowerCase()),
  );
}

/**
 * Checks if a key/label indicates third-party hosting.
 */
function isThirdPartyHosted(configKey: string, labelKey: string): boolean {
  return THIRD_PARTY_HOSTING_KEYWORDS.some(
    (kw) => configKey.includes(kw) || labelKey.includes(kw),
  );
}

export const getIconTypeKey = (name: string | undefined, type: string | undefined, label: string | undefined): string => {
  const iconKey = (name || type || '').toLowerCase();

  for (const { key, values } of ICON_TYPE_KEYS_ARRAY) {
    if (values.includes(iconKey)) return key;
    if (label && values.some((keyword) => label.toLowerCase().includes(keyword))) return key;
  }

  return 'DEFAULT';
};

const getCfgData = (cfg: Record<string, unknown>): Record<string, unknown> | undefined => {
  return cfg.data as Record<string, unknown> | undefined;
};

/**
 * Checks if a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.trim().length > 0;
}

/**
 * Extracts a non-empty string field from a config object, trying multiple key names.
 */
const extractField = (
  cfg: Record<string, unknown>,
  ...keys: Array<keyof (Record<string, unknown> & { data?: Record<string, unknown> } & { settings?: Record<string, unknown> } & { config?: Record<string, unknown> } & { metadata?: Record<string, unknown> })>
): string | undefined => {
  // Check top-level + data.* keys
  const sources: Record<string, unknown>[] = [cfg];
  const data = getCfgData(cfg);
  if (data) sources.push(data);
  for (const source of sources) {
    for (const key of keys) {
      if (isNonEmptyString(source[key])) return String(source[key]);
    }
  }
  // Check dedicated nested locations
  if ((cfg.settings as Record<string, unknown> | undefined)?.title) return String((cfg.settings as Record<string, unknown>).title);
  if ((cfg.config as Record<string, unknown> | undefined)?.name) return String((cfg.config as Record<string, unknown>).name);
  const metadata = cfg.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const titleVal = metadata.title;
    if (isNonEmptyString(titleVal)) return String(titleVal);
    const nameVal = metadata.name;
    if (isNonEmptyString(nameVal)) return String(nameVal);
  }
  return undefined;
};

export const getConfigurationDisplayName = (configuration: Record<string, unknown>): string => {
  const rawName =
    (configuration.label as string | undefined) ||
    extractField(configuration, 'name', 'model', 'model_name', 'title', 'elitea_title', 'name') ||
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
  const configKey = (name || type || '').toLowerCase();
  const labelKey = (label || '').toLowerCase();

  if (isThirdPartyHosted(configKey, labelKey)) {
    return OTHER_GROUP_LABEL;
  }

  if (matchesGroupTypes(configKey, OPENAI_GROUP_TYPES)) {
    return CONFIGURATION_TYPE_GROUPS.OpenAI.label;
  }
  if (labelKey && matchesGroupTypes(labelKey, OPENAI_GROUP_TYPES)) {
    return CONFIGURATION_TYPE_GROUPS.OpenAI.label;
  }

  if (matchesGroupTypes(configKey, ANTHROPIC_GROUP_TYPES)) {
    return CONFIGURATION_TYPE_GROUPS.Anthropic.label;
  }
  if (labelKey && matchesGroupTypes(labelKey, ANTHROPIC_GROUP_TYPES)) {
    return CONFIGURATION_TYPE_GROUPS.Anthropic.label;
  }

  return OTHER_GROUP_LABEL;
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
        value: `${String((config.name as string) ?? '')}<<>>${String((config.project_id as string) ?? '')}`,
        label: (config.display_name as string | undefined) || (config.name as string) || '',
        icon: iconRenderer ? iconRenderer(config.project_id as string) : undefined,
      })) || []
  );
};
