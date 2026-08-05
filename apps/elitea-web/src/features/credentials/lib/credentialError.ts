/**
 * lib/credentialError.ts — maps a save/test-connection API error onto
 * per-field form errors (unit A7). Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/lib/helpers/credentialError.helpers.js`
 * `extractInformationFromCredentialError`.
 *
 * DEVIATION (disclosed, forced by ownership scope): the baseline's
 * `authentication`-keyword branch also calls
 * `ToolBaseHelpers.isSecretField(key, format, secret, settings[key])`
 * (`features/toolkits/lib/helpers`, the toolkits domain — A4, out of this
 * unit's ownership fence). Reimplemented locally as `isLikelySecretField`
 * in `./schemaField.ts` using the same schema markers this unit's own form
 * renderer already reads (`format === 'password'`, `secret === true`, or a
 * name heuristic) — not a byte-for-byte port of A4's helper, since that
 * helper cannot be imported cross-domain (R-L1 layer rule: sibling
 * `features/*` slices do not import each other).
 */
import type { ConfigSchemaNode } from '../api/configurations';

import { isLikelySecretField } from './schemaField';

interface CredentialApiError {
  readonly data?: { readonly message?: unknown };
}

export interface ExtractCredentialErrorParams {
  readonly error: CredentialApiError;
  readonly schemaProperties: Readonly<Record<string, ConfigSchemaNode>>;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** The direct-match rules: title, description, the field's own current string value, or its key name literally appearing in the message. Split out of `extractInformationFromCredentialError` to keep that function's cyclomatic complexity within the §3.5 budget. */
function matchesFieldDirectly(normalizedMessage: string, key: string, property: ConfigSchemaNode | undefined, settingValue: unknown): boolean {
  const title = (property?.title ?? '').toLowerCase();
  const description = (property?.description ?? '').toLowerCase();
  if (title !== '' && normalizedMessage.includes(title)) return true;
  if (description !== '' && normalizedMessage.includes(description)) return true;
  if (typeof settingValue === 'string' && settingValue !== '' && normalizedMessage.includes(settingValue.toLowerCase())) return true;
  return normalizedMessage.includes(key.toLowerCase());
}

/** One field's match decision — direct match, else the "authentication" keyword on a secret-shaped field, else the "url" keyword on a url-named field. */
function fieldMatchesMessage(normalizedMessage: string, key: string, property: ConfigSchemaNode | undefined, settingValue: unknown): boolean {
  if (matchesFieldDirectly(normalizedMessage, key, property, settingValue)) return true;
  if (normalizedMessage.includes('authentication') && isLikelySecretField(key, property)) return true;
  return normalizedMessage.includes('url') && key.toLowerCase().includes('url');
}

/**
 * Exact port of `extractInformationFromCredentialError`: scans the error
 * message for a schema field's title/description, its own current value (if
 * a string), or its key name; a secret-shaped field also matches on the
 * literal word "authentication"; a `url`-named field also matches on the
 * literal word "url". If nothing matched, EVERY `url`-named field is
 * flagged as a fallback (baseline's own final-else branch).
 */
export function extractInformationFromCredentialError(
  params: ExtractCredentialErrorParams,
): { readonly newErrors: Readonly<Record<string, string>> } {
  const { error, schemaProperties, settings } = params;
  const message = error.data?.message;
  if (typeof message !== 'string') return { newErrors: {} };

  const normalizedMessage = message.toLowerCase();
  const newErrors: Record<string, string> = {};

  for (const key of Object.keys(schemaProperties)) {
    if (fieldMatchesMessage(normalizedMessage, key, schemaProperties[key], settings[key])) {
      newErrors[key] = message;
    }
  }

  if (Object.keys(newErrors).length === 0) {
    for (const key of Object.keys(schemaProperties)) {
      if (key.toLowerCase().includes('url')) newErrors[key] = message;
    }
  }

  return { newErrors };
}
