/**
 * lib/credentialWarning.ts — detects whether a toolkit-form edit changed a
 * PRIVATE credential selection (a team-visibility hazard: other team
 * members without a matching private credential lose the toolkit), and
 * reverts just those fields. Ported from
 * `apps/elitea-ui/src/[fsd]/entities/credential-warning/helpers/credentialWarning.helpers.js`.
 *
 * Placed under `features/credentials/lib/` rather than a standalone
 * `entities/credential-warning` slice: the baseline's own file has no
 * network calls, no domain type of its own (it operates on a generic
 * "tool detail with a `settings` bag" shape from the toolkits domain), and
 * this port's public surface is exactly the two pure functions the
 * baseline exports — a `lib/` helper is the correct fit per spec §3.3
 * rather than inventing a whole new entity slice for two functions.
 */

/** A single `settings[key]` entry shaped like a saved credential reference. */
interface CredentialSettingValue {
  readonly elitea_title?: string;
  readonly private?: boolean;
  readonly [key: string]: unknown;
}

function isCredentialSettingValue(value: unknown): value is CredentialSettingValue {
  return typeof value === 'object' && value !== null && 'elitea_title' in value;
}

export interface ToolDetailLike {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * True when at least one `settings` entry that looks like a credential
 * reference changed its `private` flag or `elitea_title` between `original`
 * and `current`. Exact port of `hasCredentialConfigChanged`.
 */
export function hasCredentialConfigChanged(current: ToolDetailLike | undefined, original: ToolDetailLike | undefined): boolean {
  const currentSettings = current?.settings ?? {};
  const originalSettings = original?.settings ?? {};

  return Object.keys(currentSettings).some((key) => {
    const curr = currentSettings[key];
    const orig = originalSettings[key];
    if (!isCredentialSettingValue(curr)) return false;
    if (!isCredentialSettingValue(orig) || !orig.elitea_title) return false;
    return curr.private !== orig.private || curr.elitea_title !== orig.elitea_title;
  });
}

/**
 * Reverts only the `settings` entries that changed credential selection
 * back to their original value, leaving every other field untouched. Exact
 * port of `revertCredentialFields`.
 */
export function revertCredentialFields(editToolDetail: ToolDetailLike | undefined, originalDetails: ToolDetailLike | undefined): ToolDetailLike | undefined {
  if (!originalDetails || !editToolDetail) return editToolDetail;

  const originalSettings = originalDetails.settings ?? {};
  const currentSettings = editToolDetail.settings ?? {};
  const revertedSettings: Record<string, unknown> = { ...currentSettings };

  for (const key of Object.keys(currentSettings)) {
    const curr = currentSettings[key];
    const orig = originalSettings[key];
    if (!isCredentialSettingValue(curr)) continue;
    if (!isCredentialSettingValue(orig) || !orig.elitea_title) continue;
    if (curr.private !== orig.private || curr.elitea_title !== orig.elitea_title) {
      revertedSettings[key] = orig;
    }
  }

  return { ...editToolDetail, settings: revertedSettings };
}
