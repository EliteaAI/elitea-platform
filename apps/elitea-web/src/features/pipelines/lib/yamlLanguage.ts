import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

/**
 * A hand-rolled `@codemirror/language` `StreamLanguage` for YAML — the
 * *syntax-highlighting* half of what `createYamlLinter` (`./yamlLint.ts`)
 * left as a documented gap. That file's own doc comment explains why: the
 * baseline's highlighting came from `StreamLanguage.define(yaml)` over
 * `@codemirror/legacy-modes/mode/yaml`, and neither that package nor
 * `@codemirror/lang-yaml` is an installed dependency, and adding one is a
 * toolchain-level decision outside a single feature slice's scope (spec
 * §2.5 — the exact call already made, independently, by the sibling
 * `features/toolkits/ui/form/ToolBase/codeLanguageExtensions.ts`, whose own
 * doc comment cites the same constraint for the same reason: "adding ~15
 * new packages is outside a settings-form sub-unit's scope").
 *
 * What's different here: rather than leaving YAML unhighlighted (that
 * file's fallback), this defines a small `StreamParser` from scratch, using
 * only `@codemirror/language`'s own `StreamLanguage`/`StringStream` (already
 * an installed dependency — no new package). It is intentionally a subset
 * of real YAML — exactly the three constructs the pipeline flow editor's
 * YAML actually needs readable at a glance (mapping keys, quoted/plain
 * scalars, comments), plus a few cheap extras (booleans/null, list
 * markers, anchors/aliases/tags, document markers) — not a spec-complete
 * grammar. Notably NOT handled: multi-line block scalars (`|`/`>`) and
 * flow-mapping keys nested inside `{...}`/`[...]` are tokenized as plain
 * text rather than recursively re-applying the key rule. Both are rare in
 * this app's pipeline YAML (a linear sequence of `key: value` mapping
 * lines) and, if they ever need highlighting too, are additive follow-ups
 * to this same file, not a reason to withhold the highlighting that
 * already covers the common case.
 *
 * Token names returned by `token()` below are resolved against
 * `@lezer/highlight`'s own `tags` table (verified against
 * `node_modules/@codemirror/language/dist/index.js`'s `createTokenType` —
 * every returned string is looked up as `tags[name]`), so they land on
 * exactly the same `tags.propertyName/string/comment/atom/number/
 * punctuation` buckets `CodeMirrorEditor.tsx`'s `highlightStyle` already
 * styles — no separate highlight style needs registering here.
 */
interface YamlParserState {
  /**
   * Set once this line's mapping-key colon (if any) has been consumed, so
   * the rest of the line is treated as a value and never re-tried as a
   * second key. Reset on every new line (`stream.sol()`).
   */
  keyConsumed: boolean;
}

/** `key:` — an unquoted scalar key, ending at a colon followed by whitespace or end of line (YAML's own rule for "this colon ends a key", simplified to the common unquoted case). */
const KEY_RE = /^[^\s:#'"{}[\],&*!][^:#]*:(?=\s|$)/;
const COLON_RE = /^:(?=\s|$)/;
const DASH_RE = /^-(?=\s|$)/;
const DOC_MARKER_RE = /^(?:---|\.\.\.)(?=\s|$)/;
const ANCHOR_OR_ALIAS_RE = /^[&*][^\s,[\]{}]+/;
const TAG_RE = /^!!?[^\s,[\]{}]+/;
const FLOW_PUNCTUATION_RE = /^[[\]{},]/;
const WORD_RE = /^[^\s#]+/;
const BOOL_NULL_RE = /^(?:true|false|null|~|yes|no|on|off)$/i;
const NUMBER_RE = /^[+-]?(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?$/;

/**
 * `StringStream.match(regex, ...)` is typed `boolean | RegExpMatchArray |
 * null` because its overload also accepts a plain `string` pattern (which
 * resolves a bare `boolean`) — every call site below always passes a
 * `RegExp`, so the `boolean` arm is unreachable, but narrowing it away with
 * an `as` cast would be exactly the unsafe cast this codebase's fences ban.
 * `typeof result === 'object'` narrows losslessly instead (`true`/`false`
 * are `'boolean'`; a real match array and `null` are both `'object'`).
 */
function matchArray(result: boolean | RegExpMatchArray | null): RegExpMatchArray | null {
  return typeof result === 'object' ? result : null;
}

/** Consumes a single- or double-quoted scalar (opening quote already at `stream.pos`); always returns `'string'`. */
function readQuoted(stream: StringStream, quote: string): string {
  stream.next(); // opening quote
  if (quote === "'") {
    // YAML single-quoted strings escape a literal `'` by doubling it (`''`).
    for (;;) {
      if (!stream.skipTo("'")) {
        stream.skipToEnd(); // unterminated on this line — treat as ending at EOL
        break;
      }
      stream.next(); // the `'` skipTo stopped before
      if (stream.peek() !== "'") break; // real closing quote, not an escape
      stream.next(); // consume the second `'` of the `''` escape and keep scanning
    }
  } else {
    // YAML double-quoted strings use C-style backslash escapes.
    while (!stream.eol()) {
      const char = stream.next();
      if (char === '\\') {
        stream.next(); // skip the escaped character, whatever it is
        continue;
      }
      if (char === '"') break;
    }
  }
  return 'string';
}

/** One entry per YAML construct `token()` recognises, tried in priority order — kept as small independent rules (rather than one large `if`/`else if` chain) to stay under the R-T-adjacent `complexity` budget. `undefined` means "did not match, try the next rule". */
type TokenRule = (stream: StringStream, state: YamlParserState) => string | null | undefined;

function tokenizeComment(stream: StringStream): string | undefined {
  if (stream.peek() !== '#') return undefined;
  stream.skipToEnd();
  return 'comment';
}

function tokenizeQuoted(stream: StringStream): string | undefined {
  const quote = stream.peek();
  if (quote !== '"' && quote !== "'") return undefined;
  return readQuoted(stream, quote);
}

function tokenizeDash(stream: StringStream, state: YamlParserState): string | undefined {
  if (state.keyConsumed) return undefined;
  return stream.match(DASH_RE) ? 'punctuation' : undefined;
}

function tokenizeAnchorOrAlias(stream: StringStream): string | undefined {
  return stream.match(ANCHOR_OR_ALIAS_RE) ? 'labelName' : undefined;
}

function tokenizeTag(stream: StringStream): string | undefined {
  return stream.match(TAG_RE) ? 'typeName' : undefined;
}

function tokenizeFlowPunctuation(stream: StringStream): string | undefined {
  return stream.match(FLOW_PUNCTUATION_RE) ? 'punctuation' : undefined;
}

function tokenizeKey(stream: StringStream, state: YamlParserState): string | undefined {
  if (state.keyConsumed) return undefined;
  const match = matchArray(stream.match(KEY_RE, false));
  if (!match) return undefined;
  stream.pos = stream.start + match[0].length - 1; // stop just before the `:`
  state.keyConsumed = true;
  return 'propertyName';
}

function tokenizeColon(stream: StringStream, state: YamlParserState): string | undefined {
  if (!stream.match(COLON_RE)) return undefined;
  state.keyConsumed = true;
  return 'punctuation';
}

function tokenizeScalarWord(stream: StringStream): string | null | undefined {
  const match = matchArray(stream.match(WORD_RE));
  if (!match) return undefined;
  const text = match[0];
  if (BOOL_NULL_RE.test(text)) return 'atom';
  if (NUMBER_RE.test(text)) return 'number';
  return null; // plain scalar text — no specific tag, renders in the editor's base colour
}

const TOKEN_RULES: readonly TokenRule[] = [
  tokenizeComment,
  tokenizeQuoted,
  tokenizeDash,
  tokenizeAnchorOrAlias,
  tokenizeTag,
  tokenizeFlowPunctuation,
  tokenizeKey,
  tokenizeColon,
  tokenizeScalarWord,
];

function token(stream: StringStream, state: YamlParserState): string | null {
  if (stream.sol()) {
    state.keyConsumed = false;
    if (stream.match(DOC_MARKER_RE)) return 'meta';
  }

  if (stream.eatSpace()) return null;

  for (const rule of TOKEN_RULES) {
    const result = rule(stream, state);
    if (result !== undefined) return result;
  }

  stream.next(); // unrecognised character — consume it so the parser always advances
  return null;
}

const yamlStreamParser: StreamParser<YamlParserState> = {
  name: 'yaml',
  startState: () => ({ keyConsumed: false }),
  token,
  languageData: { commentTokens: { line: '#' } },
};

/** The pipeline YAML tab's syntax-highlighting extension — see the file doc comment above for scope. */
export function createYamlLanguage(): Extension {
  return StreamLanguage.define(yamlStreamParser).extension;
}
