/**
 * lib/credentialSelectValue.ts — the JSON-encoded value codec
 * `CredentialsSelect` uses to pack a saved-credential-row identity or a
 * create-action identity into a single string, since the MUI-backed
 * `SingleSelect` (and MUI `Select` underneath) needs a plain string
 * `value`. Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-select/CredentialsSelect.jsx:25-76`.
 *
 * Kept a pure, standalone module (not inlined in the component) because
 * this is exactly the kind of decode logic §6.7's mutation spot-check
 * targets: a malformed/foreign JSON string arriving as `value` (a stale
 * option, a manually-edited URL, cross-tab storage) must decode to `null`,
 * never throw and never silently coerce into the wrong kind.
 */

const KIND_SAVED = 'saved';
const KIND_CREATE_ACTION = 'create_action';

export interface SavedCredentialSelectValue {
  readonly eliteaTitle: string;
  readonly private: boolean;
}

export interface CreateActionSelectValue {
  readonly isPrivate: boolean;
}

/** `isBlankEliteaTitle` — exact port (`== null` covers both `null` and `undefined`, matching the baseline's loose check). */
export function isBlankEliteaTitle(title: string | null | undefined): boolean {
  return title == null || String(title).trim() === '';
}

/** `savedRowToSelectValue` — `''` for a row with no `elitea_title` (matches the "no selection" placeholder value). */
export function encodeSavedCredentialValue(row: { readonly eliteaTitle?: string | null; readonly isPrivate?: boolean } | undefined): string {
  if (isBlankEliteaTitle(row?.eliteaTitle)) return '';
  return JSON.stringify({ kind: KIND_SAVED, elitea_title: row?.eliteaTitle, private: Boolean(row?.isPrivate) });
}

/** `selectValueToSavedRow` — `null` on anything that isn't a well-formed saved-row payload, never throws. */
export function decodeSavedCredentialValue(value: string | null | undefined): SavedCredentialSelectValue | null {
  if (!value || typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record['kind'] !== KIND_SAVED) return null;
  const title = record['elitea_title'];
  if (typeof title !== 'string' || isBlankEliteaTitle(title)) return null;
  return { eliteaTitle: title, private: Boolean(record['private']) };
}

/** `createActionToSelectValue`. */
export function encodeCreateActionValue(isPrivate: boolean): string {
  return JSON.stringify({ kind: KIND_CREATE_ACTION, private: Boolean(isPrivate) });
}

/** `selectValueToCreateAction` — `null` on anything that isn't a well-formed create-action payload. */
export function decodeCreateActionValue(value: string | null | undefined): CreateActionSelectValue | null {
  if (!value || typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record['kind'] !== KIND_CREATE_ACTION) return null;
  return { isPrivate: Boolean(record['private']) };
}
