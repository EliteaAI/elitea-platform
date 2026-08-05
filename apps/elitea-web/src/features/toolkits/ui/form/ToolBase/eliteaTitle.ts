/**
 * Ported from `apps/elitea-ui/src/common/configrationTitleUtils.js` (88
 * lines). NOT promoted anywhere in this worktree (verified: `grep -rln
 * convertToValidEliteaTitle src` — zero hits outside this file at port
 * time) and not owned by any other Wave-2 sub-unit's mission brief, so
 * ported locally per the workflow's "port it yourself, locally"
 * instruction. Used by `ToolBase.tsx`'s `handleInputChange` to keep a
 * tool's `elitea_title` (its chat-participant slug) in sync with its
 * `label` as the user types, and to validate a directly-edited
 * `elitea_title`.
 */

const MAX_ELITEA_TITLE_LENGTH = 128;

/**
 * Converts an arbitrary string into a valid elitea-title string: lowercase,
 * whitespace -> underscore, strip anything but `[a-z0-9_-]`, collapse
 * repeated underscores, trim a trailing underscore, cap at 128 chars.
 * Returns `fallback` (default `''`) if the result would be empty.
 */
export function convertToValidEliteaTitle(input: string | undefined, fallback = ''): string {
  if (!input || typeof input !== 'string') {
    return fallback;
  }

  let result = input.toLowerCase();
  result = result.replace(/\s+/g, '_');
  result = result.replace(/[^a-z0-9_-]/g, '');
  result = result.replace(/_+/g, '_');
  result = result.replace(/_+$/g, '');

  if (result.length > MAX_ELITEA_TITLE_LENGTH) {
    result = result.substring(0, MAX_ELITEA_TITLE_LENGTH);
    result = result.replace(/_+$/, '');
  }

  return result || fallback;
}

const ELITEA_TITLE_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** True when `value` is non-empty, at most 128 characters, and matches `[a-zA-Z0-9_-]+`. */
export function isValidEliteATitle(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  if (value.length > MAX_ELITEA_TITLE_LENGTH) return false;
  return ELITEA_TITLE_PATTERN.test(value);
}

/** Returns a human-readable validation error for `value`, or `null` when valid. `participantName` (default `'Elitea'`) is interpolated into every message, mirroring the baseline's `systemSenderName` parameter. */
export function getEliteATitleValidationError(value: string | undefined, participantName: string): string | null {
  if (!value) {
    return `${participantName} title cannot be empty`;
  }
  if (value.length > MAX_ELITEA_TITLE_LENGTH) {
    return `${participantName} title must not exceed 128 characters`;
  }
  if (!ELITEA_TITLE_PATTERN.test(value)) {
    return `${participantName} title must contain only alphanumeric characters, underscores, and hyphens (no spaces or other special symbols)`;
  }
  return null;
}
