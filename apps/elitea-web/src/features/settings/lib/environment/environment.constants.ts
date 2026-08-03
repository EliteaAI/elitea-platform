/**
 * Environment field constants.
 *
 * Uses 'environment_settings' to match the old-app convention
 * (apps/elitea-ui/src/[fsd]/features/settings/lib/constants/environment.constants:2)
 * so the API section name is preserved for parity.
 */

export const ENVIRONMENT_SECTION = 'environment_settings' as const;

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
