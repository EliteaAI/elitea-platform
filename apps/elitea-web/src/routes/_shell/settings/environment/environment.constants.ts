/**
 * Environment field constants.
 */

export const ENVIRONMENT_SECTION = 'environment' as const;

export const ENVIRONMENT_FIELD_ORDER = [
  'llm_server_url',
  'auth_token',
  'model_name',
  'llm_model_name',
  'project_id',
  'integration_uid',
  'verify_ssl',
  'display_type',
  'debug',
  'default_view_mode',
] as const;

export const ENVIRONMENT_FIELD_DEFAULTS: Record<string, string | number | boolean | undefined> = {
  llm_server_url: '',
  auth_token: '',
  model_name: '',
  llm_model_name: '',
  project_id: '',
  integration_uid: '',
  verify_ssl: false,
  display_type: 'split',
  debug: false,
  default_view_mode: 'split',
};
