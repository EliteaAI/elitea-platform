/**
 * Environment field constants.
 *
 * Uses 'environment_settings' to match the old-app convention
 * (apps/elitea-ui/src/[fsd]/features/settings/lib/constants/environment.constants:2)
 * so the API section name is preserved for parity.
 *
 * Field keys/order/defaults mirror the REAL backend schema:
 *  - apps/elitea-ui/src/[fsd]/shared/lib/constants/environment.constants.js
 *    (`ENVIRONMENT_KEYS = { SYSTEM_SENDER_NAME, ERROR_TOAST_DURATION }`)
 *  - apps/elitea-ui/src/[fsd]/features/settings/lib/constants/
 *    environment.constants.js:5-15 (`ENVIRONMENT_FIELD_ORDER`,
 *    `ENVIRONMENT_FIELD_DEFAULTS`)
 *
 * A prior revision of this file fabricated a ten-field schema
 * (`llm_server_url`, `auth_token`, ...) that appears nowhere in the old
 * app — a confirmed regression (adversarial review, A9). Restored to the
 * real two-field schema here.
 */

export const ENVIRONMENT_SECTION = 'environment_settings' as const;

const ENVIRONMENT_KEYS = {
  SYSTEM_SENDER_NAME: 'system_sender_name',
  ERROR_TOAST_DURATION: 'error_toast_duration',
} as const;

export const ENVIRONMENT_FIELD_ORDER = [
  ENVIRONMENT_KEYS.SYSTEM_SENDER_NAME,
  ENVIRONMENT_KEYS.ERROR_TOAST_DURATION,
] as const;

/**
 * Per-field min/max constraint fallbacks — consulted only when the
 * backend's `config_schema` omits `minimum`/`maximum` for that field
 * (`environmentField.helpers.ts`'s `buildFieldDefinition` prefers the
 * schema-provided values and falls back to this map, never the reverse).
 */
export const ENVIRONMENT_FIELD_DEFAULTS: Record<string, { minimum?: number; maximum?: number } | undefined> = {
  [ENVIRONMENT_KEYS.ERROR_TOAST_DURATION]: {
    minimum: 5000,
    maximum: 20000,
  },
};
