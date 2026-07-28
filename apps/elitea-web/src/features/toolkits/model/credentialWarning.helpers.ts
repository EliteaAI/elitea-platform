/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/entities/credential-warning/
 * helpers/credentialWarning.helpers.js` (44 lines).
 *
 * NOT promoted to `entities/`: the Wave-2 promotion pass's own scope (see
 * `entities/toolkit`'s index.ts doc comment, Parts 1-3) did not include
 * `credential-warning`, and its sole FSD-tree consumer is this slice's own
 * `ToolkitsOperationButtons.tsx` (grepped: the baseline's other reference,
 * `shared/ui/banner-message/BannerMessage.jsx:42`, is an unrelated
 * `data-testid` string, not an import). Ported locally rather than as a new
 * `entities/credential-warning` slice — creating a new entities slice is a
 * bigger architectural call than this sub-unit's single-consumer file list
 * warrants.
 */
interface CredentialLikeSettingsValue {
  readonly elitea_title?: string;
  readonly private?: boolean;
}

export interface CredentialWarningDetail {
  readonly settings?: Readonly<Record<string, unknown>>;
}

function isCredentialLike(value: unknown): value is CredentialLikeSettingsValue {
  return typeof value === 'object' && value !== null && 'elitea_title' in value;
}

/** True when any settings field looks like a shared-credential reference (`{elitea_title, private}`) whose `private`/`elitea_title` differs from the original. */
export function hasCredentialConfigChanged(current: CredentialWarningDetail | undefined, original: CredentialWarningDetail | undefined): boolean {
  const currentSettings = current?.settings ?? {};
  const originalSettings = original?.settings ?? {};

  return Object.keys(currentSettings).some((key) => {
    const curr = currentSettings[key];
    const orig = originalSettings[key];
    if (!isCredentialLike(curr) || !isCredentialLike(orig) || !orig.elitea_title) return false;
    return curr.private !== orig.private || curr.elitea_title !== orig.elitea_title;
  });
}

export interface RevertedCredentialDetail extends CredentialWarningDetail {
  readonly [key: string]: unknown;
}

/** Reverts only the credential-like settings fields that changed from the original, leaving everything else untouched. */
export function revertCredentialFields(
  editToolDetail: RevertedCredentialDetail | undefined,
  originalDetails: CredentialWarningDetail | undefined,
): RevertedCredentialDetail | undefined {
  if (!originalDetails || !editToolDetail) return editToolDetail;

  const originalSettings = originalDetails.settings ?? {};
  const currentSettings = editToolDetail.settings ?? {};
  const revertedSettings: Record<string, unknown> = { ...currentSettings };

  for (const key of Object.keys(currentSettings)) {
    const curr = currentSettings[key];
    const orig = originalSettings[key];
    if (isCredentialLike(curr) && isCredentialLike(orig) && orig.elitea_title && (curr.private !== orig.private || curr.elitea_title !== orig.elitea_title)) {
      revertedSettings[key] = orig;
    }
  }

  return { ...editToolDetail, settings: revertedSettings };
}
