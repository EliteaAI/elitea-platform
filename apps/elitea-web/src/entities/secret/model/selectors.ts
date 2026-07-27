import type { Secret } from './types';

/**
 * apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/
 * useSecretVisibility.hooks.js:77-93 `handleHideSecretPermanently` guard —
 * default secrets cannot be permanently hidden/deleted.
 */
export function isSecretHideable(secret: Secret): boolean {
  return !secret.isDefault;
}

/**
 * apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/
 * useSecretVisibility.hooks.js:57-75 `handleHideSecret` — reverts the
 * displayed value back to the masked reference (`secretName`).
 */
export function maskSecretValue(secret: Secret): string {
  return secret.secretName;
}

/**
 * apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/SecretsContent.jsx
 * :59-65 — case-insensitive substring filter over secret names.
 */
export function filterSecretsByName(secrets: readonly Secret[], query: string): Secret[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...secrets];
  return secrets.filter((secret) => secret.name.toLowerCase().includes(needle));
}
