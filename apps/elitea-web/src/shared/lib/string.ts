/**
 * String / template-placeholder helpers ported from
 * apps/elitea-ui/src/common/utils.jsx (unit S3, spec §9.3).
 */

/**
 * Uppercases the first character of `str`, leaving the rest unchanged.
 * `''` is a safe no-op (`''.charAt(0)` is `''`).
 */
export function capitalizeFirstChar(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const ESCAPE_REGEXP = /[.*+\-?^${}()|[\]\\]/g;

/** Escapes regex-special characters so `str` can be embedded in a `RegExp`. */
export function escapeString(str: string): string {
  return str.replace(ESCAPE_REGEXP, '\\$&');
}

export interface HighlightSegment {
  readonly text: string;
  readonly highlight: boolean;
}

/**
 * Splits `str` on every (case-insensitive) occurrence of `keyword`, tagging
 * each resulting segment with whether it IS a keyword match — the source
 * data for search-result highlighting UIs.
 *
 * Investigated for a N4-style parity quirk (old-app `utils.jsx:639-659`):
 * the capturing `RegExp` is built ONCE with the `g` flag and reused across
 * every `.test(element)` call in the loop, and a stateful `lastIndex` on a
 * `/g` pattern can in general desync `.test()` results. Empirically this
 * does NOT produce an observable bug here: `String.prototype.split` on a
 * global capturing regex always alternates non-match/match/non-match/…, the
 * non-match segments can never themselves contain the keyword (otherwise
 * `split` would have split there too), and a FAILED `.test()` unconditionally
 * resets `lastIndex` to `0` — so every non-match segment re-arms the regex
 * before the next keyword segment is tested. Verified by exhaustive-ish
 * table tests (see `string.test.ts`) rather than left as an assumption.
 * Reused (not per-element fresh) `RegExp` kept anyway, matching the old
 * app's structure 1:1 now that it is confirmed behaviourally equivalent.
 */
export function splitStringByKeyword(str: string, keyword: string): HighlightSegment[] {
  if (!keyword) {
    return [{ text: str, highlight: false }];
  }
  const pattern = new RegExp(`(${escapeString(keyword)})`, 'gi');
  const parts = str ? str.split(pattern) : [];
  const result: HighlightSegment[] = [];
  for (const text of parts) {
    result.push({ text, highlight: pattern.test(text) });
  }
  return result;
}

/**
 * `firstChar + lastChar` of `name`, uppercased (e.g. avatar initials).
 * Parity: throws `TypeError` for non-string input rather than coercing —
 * the declared parameter type is `string`, but the runtime guard is kept
 * for callers crossing an untyped boundary (e.g. JSON API data before it is
 * validated), exactly like the old app.
 */
export function getInitials(name: string): string {
  if (typeof name !== 'string') {
    throw new TypeError('Name must be a string');
  }
  const names = name.split(' ');
  let firstName = names[0] ?? '';
  let lastName = names[names.length - 1] ?? '';
  if (names.length === 1) {
    firstName = name;
    lastName = '';
  }
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * Deterministic hash-based hex color for a string (e.g. a stable avatar
 * background derived from a user's name). This is a COMPUTED runtime value,
 * not a source-code color literal or a brand/design token — R-T1 governs
 * literals authored in `sx`/`styled`, not values this function returns.
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }
  return color;
}

const PLACEHOLDER_RE = /{{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*}}/g;
const PLACEHOLDER_CAPTURE_RE = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/;

/**
 * Extracts the bare variable name from each `{{ variable }}` placeholder
 * string, de-duplicating (first-seen order, via `Set`).
 */
export function extractPlaceholders(placeholders: readonly string[] = []): string[] {
  const names = placeholders.map((str) => str.replace(PLACEHOLDER_CAPTURE_RE, '$1'));
  return Array.from(new Set(names));
}

/**
 * Finds every `{{ variable }}` placeholder in `context` and returns the
 * unique variable names, alphabetically sorted.
 */
export function contextResolver(context = ''): string[] {
  const matches = context.match(PLACEHOLDER_RE);
  if (!matches) return [];
  return extractPlaceholders(matches).sort();
}
