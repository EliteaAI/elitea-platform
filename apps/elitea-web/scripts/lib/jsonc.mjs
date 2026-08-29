/**
 * jsonc.mjs — a tiny string-aware JSONC stripper.
 *
 * Two configuration files in this app carry comments and still have to be read
 * by a script: `.oxlintrc.json` (scripts/check-gates-selftest.mjs copies it
 * per fixture case) and `knip.json` (scripts/check-dead-code.mjs reads its
 * `project` globs to count what knip analyses). `JSON.parse` rejects both.
 *
 * It lived inside check-gates-selftest.mjs. Issue #528 moved it here, because
 * importing it from there runs the whole self-test as a side effect.
 *
 * The scanner has four states. Each handler answers with
 * `[nextState, emit, skipNext]`, so a comment introducer inside a string
 * literal stays in the output and an escaped quote does not end the string.
 */
const JSONC_STATES = {
  code(c, n) {
    if (c === '"') return ['string', c, false];
    if (c === '/' && n === '/') return ['line', '', true];
    if (c === '/' && n === '*') return ['block', '', true];
    return ['code', c, false];
  },
  string(c, n) {
    if (c === '\\') return ['string', c + (n ?? ''), true];
    return [c === '"' ? 'code' : 'string', c, false];
  },
  line(c) {
    return c === '\n' ? ['code', c, false] : ['line', '', false];
  },
  block(c, n) {
    return c === '*' && n === '/' ? ['code', '', true] : ['block', '', false];
  },
};

/**
 * Drop a comma that only a comment used to separate from its closing bracket.
 *
 * knip.json ends `ignoreDependencies` with a real entry, then eleven lines of
 * comment, then `]`. Removing the comments leaves `"…",\n]`, which
 * `JSON.parse` rejects. The pass is string-aware for the same reason the
 * comment scanner is: a comma inside a string literal stays.
 *
 * @param {string} text comment-free JSON text.
 * @returns {string} the same text with trailing commas removed.
 */
function dropTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      const rest = text.slice(i + 1);
      const following = rest[rest.match(/^\s*/)[0].length];
      if (following === ']' || following === '}') continue;
    }
    out += c;
  }
  return out;
}

/**
 * Remove `//` and comments, and the trailing commas they leave behind.
 *
 * @param {string} text the JSONC source.
 * @returns {string} plain JSON, ready for `JSON.parse`.
 */
export function stripJsonc(text) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < text.length; i++) {
    const [next, emit, skip] = JSONC_STATES[state](text[i], text[i + 1]);
    state = next;
    out += emit;
    if (skip) i++;
  }
  return dropTrailingCommas(out);
}
