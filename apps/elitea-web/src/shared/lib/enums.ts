/**
 * Small domain enums ported from apps/elitea-ui/src/common/constants.js
 * (unit S3, spec §9.3).
 */

/** `constants.js:101-104`. */
export const PipelineEditorMode = {
  Flow: 'flow',
  Yaml: 'yaml',
} as const;

/** `constants.js:111-124`. Includes user-visible `label`s (see S3 report). */
export const CapabilityTypes = {
  completion: { label: 'Text', value: 'completion' },
  chat_completion: { label: 'Chat', value: 'chat_completion' },
  embeddings: { label: 'Embeddings', value: 'embeddings' },
} as const;

/** `constants.js:134-138`. */
export const ROLES = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
} as const;

export const WELCOME_MESSAGE_ID = 'welcome_message_id';

/** `constants.js:309-333`. */
export const ViewOptions = {
  Table: 'table',
  Cards: 'cards',
} as const;

export const ToolkitViewOptions = {
  Json: 'json',
  Form: 'form',
} as const;

export const ThemeModeOptions = {
  Dark: 'dark',
  Light: 'light',
} as const;

export const ComponentMode = {
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  VIEW: 'VIEW',
} as const;

export const ViewMode = {
  Owner: 'owner',
  Public: 'public',
} as const;

/**
 * `constants.js:670-683`. Live consumer confirmed (correcting an earlier
 * miss in this unit's dead-code sweep — the original automated pass
 * false-negatived this exact name): `AuthenticationTypes.None.value` is the
 * default `authentication.type` baked into the OpenAPI tool's
 * `ToolInitialValues` in `apps/elitea-ui/src/pages/Applications/Components/Tools/consts.js:208`,
 * which is imported by 25+ live toolkit/pipeline modules. Includes
 * user-visible `label`s (see S3 report re: S8/i18n).
 */
export const AuthenticationTypes = {
  None: { label: 'None', value: 'none' },
  APIKey: { label: 'API Key', value: 'api_key' },
  OAuth: { label: 'OAuth', value: 'oauth' },
} as const;
