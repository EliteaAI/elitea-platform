/**
 * The pre-built MCP server dialog's data rules, separated from its rendering.
 *
 * These are the parts worth reading and testing on their own: the key
 * derivation that has to match the server character for character, the
 * tri-state that decides whether a credential survives a save, and the
 * client-side checks. `./AdminMcpServerDialog.tsx` is the controls.
 */
import { t } from '@/shared/i18n';

import type { AdminMcpServer } from './api/adminMcpServersApi';

/**
 * The server's `NormalizeCatalogueKey`, reproduced so the operator sees the key
 * their display name will be stored under before they save it.
 *
 * It must stay identical to `internal/mcpregistry.NormalizeCatalogueKey`,
 * INCLUDING the order: lowercase, spaces to underscores, THEN trim, then strip
 * a leading `mcp_`. Trimming first would produce a different key from the one
 * the server stores, and the lookup a toolkit does at run time would miss.
 */
export function normalizeCatalogueKey(name: string): string {
  if (name === '') return '';
  const normalized = name.toLowerCase().replaceAll(' ', '_').trim();
  return normalized.startsWith('mcp_') ? normalized.slice(4) : normalized;
}

/**
 * The dialog's fields as ONE state object.
 *
 * Nine separate `useState` hooks made the reset effect a list of nine setters,
 * each with its own fallback — nine chances for a field to be reset from the
 * wrong source, and no single place to read what "opening on this entry" means.
 */
export interface McpServerForm {
  readonly displayName: string;
  readonly url: string;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clearSecret: boolean;
  readonly timeout: string;
  readonly enabled: boolean;
}

/** A blank form: what "Add MCP server" opens on. */
const EMPTY_FORM: McpServerForm = {
  displayName: '',
  url: '',
  baseUrl: '',
  clientId: '',
  clientSecret: '',
  clearSecret: false,
  timeout: '',
  enabled: true,
};

/**
 * What the dialog shows when it opens on an entry, or on nothing.
 *
 * `clientSecret` is ALWAYS empty and `clearSecret` always false, whatever the
 * entry holds: the server never sends the secret, so there is nothing to
 * pre-fill with, and "untouched" must mean "leave the sealed one alone".
 *
 * A zero timeout renders as an EMPTY field. Zero means "not configured" on the
 * server, so the caller's own default applies; showing a literal 0 would read
 * as a zero-second timeout the operator had chosen.
 */
export function initialForm(editing: AdminMcpServer | undefined): McpServerForm {
  if (editing === undefined) return EMPTY_FORM;
  return {
    displayName: editing.display_name,
    url: editing.url,
    baseUrl: editing.base_url,
    clientId: editing.client_id,
    clientSecret: '',
    clearSecret: false,
    timeout: editing.timeout > 0 ? String(editing.timeout) : '',
    enabled: editing.enabled,
  };
}

/**
 * Turns the two secret controls into the tri-state the server reads.
 *
 * `undefined` ⇒ omit the field, leaving the sealed secret alone. `''` ⇒ clear
 * it. A value ⇒ re-seal it.
 *
 * This is the one place on this screen where a wrong answer silently and
 * permanently destroys a credential, and it is three lines that look obviously
 * right — which is exactly why it is a named function with its own test.
 */
export function resolveSecretForSave(typed: string, clear: boolean): string | undefined {
  // Clearing WINS over a typed value. The checkbox disables the field, so a
  // keystroke left over from before it was ticked must not resurrect a secret
  // the operator chose to remove.
  if (clear) return '';
  if (typed === '') return undefined;
  return typed;
}

/**
 * The dialog's client-side checks, as one pure function.
 *
 * Returns the message to show, or `undefined` when the draft is acceptable.
 * These are a COURTESY: the server refuses each of them independently
 * (`internal/api/v2/admin/mcp_prebuilt.go`), and its refusal is what the dialog
 * renders when the two disagree.
 */
export function validateDraft(
  displayName: string,
  timeout: string,
  isEdit: boolean,
  existingKeys: ReadonlySet<string>,
): string | undefined {
  const name = displayName.trim();
  if (name === '') {
    return t('pages.admin.mcpServers.dialog.error.nameRequired', 'Display name is required.');
  }
  const key = normalizeCatalogueKey(name);
  if (key === '') {
    return t(
      'pages.admin.mcpServers.dialog.error.keyEmpty',
      'That name has no usable catalogue key. Include a letter or a digit.',
    );
  }
  if (!isEdit && existingKeys.has(key)) {
    return t(
      'pages.admin.mcpServers.dialog.error.duplicate',
      'A catalogued server already uses that key.',
    );
  }
  const seconds = timeout.trim() === '' ? 0 : Number(timeout);
  if (!Number.isInteger(seconds) || seconds < 0) {
    return t(
      'pages.admin.mcpServers.dialog.error.timeout',
      'Timeout must be a whole number of seconds, or empty for the default.',
    );
  }
  return undefined;
}

/** The catalogue key the entry is, or will be, stored under. */
export function keyHelperText(fixedKey: string | undefined, displayName: string): string {
  if (fixedKey !== undefined) {
    return t('pages.admin.mcpServers.dialog.keyFixed', 'Catalogue key: {{key}} (cannot change)', {
      key: fixedKey,
    });
  }
  return t('pages.admin.mcpServers.dialog.keyDerived', 'Catalogue key: {{key}}', {
    key: normalizeCatalogueKey(displayName.trim()) || '—',
  });
}
