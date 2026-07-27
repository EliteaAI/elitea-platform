/**
 * Validation regexes/messages + boolean-flag parsing ported from
 * apps/elitea-ui/src/common/constants.js (unit S3, spec §9.3).
 */

/** `constants.js:91-97`. */
export const NormalTagNameInputRegExp = /^[\w,\s]+$/g;
export const NormalSingleTagNameInputRegExp = /^[ \t]*[\w]*[ \t]*$/g;
export const ConversationNameRegExp = /^[a-zA-Z0-9_[\].()][a-zA-Z0-9_[\].() -]{2,63}$/;

/**
 * User-visible copy — candidate for `shared/i18n/en.json` (unit S8, R-T3).
 * Ported verbatim as a parity floor until S8 lands.
 */
export const ConversationNameWarningMessage =
  'The chat name should be 3 to 64 characters long. It can include letters (a-z, A-Z), numbers (0-9), underscores (_), brackets ([]), parentheses (()), dots (.), hyphen(-), and spaces. Please note that the first character should not be a space.';
export const FolderNameWarningMessage =
  'The folder name should be 3 to 64 characters long. It can include letters (a-z, A-Z), numbers (0-9), underscores (_), brackets ([]), parentheses (()), dots (.), hyphen(-), and spaces. Please note that the first character should not be a space.';

/**
 * Coerces a raw env-style flag value to boolean. Ported from the private
 * `isFlagEnabled` helper in `constants.js:21-24`, which backs
 * `VOICE_FEATURES_ENABLED`/`VOICE_FEATURES_TEMPORARILY_DISABLED`.
 *
 * Gap noted for F3 (`shared/config`): those two flags, plus
 * `ALLOW_PROJECT_OWN_LLMS`/`ELITEA_ASSISTANT_ENABLED`/`BLOCKED_TOOLKITS`,
 * are env-derived config in the old app but are NOT YET present in F3's
 * `ConfigSchema` (`shared/config/schema.ts`), which only covers the 5 C7
 * keys. This helper is ready for whichever unit closes that gap; it does
 * not itself read any env source (that stays F3's job, §7.1).
 */
export function parseBooleanFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  return value === '1' || value === 1 || value === true;
}
