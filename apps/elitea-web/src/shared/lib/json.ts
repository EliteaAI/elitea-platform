/**
 * JSON conversion helpers ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 */

/**
 * Parses `content` as JSON, returning `{}` (not `null`/throwing) on any
 * parse failure — preserved for parity with the old app's silent-swallow
 * `catch {}` (`utils.jsx:830-838`).
 */
export function convertToJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return {};
  }
}

/**
 * Stringifies non-string `content` with 2-space indentation; string input
 * passes through unchanged. `inBlock` wraps the stringified result in a
 * fenced ```json code block. Falls back to `String(content)` if
 * `JSON.stringify` throws (e.g. a circular reference).
 */
export function convertJsonToString(content: unknown, inBlock = false): string {
  if (typeof content === 'string') {
    return content;
  }
  try {
    const pretty = JSON.stringify(content, null, 2);
    return inBlock ? '```json\n ' + pretty + '\n```' : pretty;
  } catch {
    return String(content);
  }
}
