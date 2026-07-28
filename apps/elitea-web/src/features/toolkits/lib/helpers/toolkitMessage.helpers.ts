/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolkits.helpers.js:127-282` (Wave-2 unit A4b) — chat-message
 * pretty-printing for the toolkit test/index chat panel: a bare JSON
 * message renders as a fenced block (or, for an indexing-result payload,
 * a human summary); a "Calling tool 'x' with parameters: ..." message gets
 * its Python-repr'd kwargs reformatted as JSON.
 *
 * Split out of `./toolkits.helpers.ts` purely to stay under the §3.5
 * 400-line-per-file budget — see that file's own doc comment for the full
 * split rationale. No external dependencies (pure string/JSON parsing).
 */

/** One attempted parse of a raw parameter-value string; `undefined` means "this parser doesn't apply, try the next one". */
type ValueParser = (value: string) => { readonly matched: true; readonly value: unknown } | { readonly matched: false };

const parseNullLiteral: ValueParser = (value) => (value === 'None' || value === 'null' ? { matched: true, value: null } : { matched: false });
const parseTrueLiteral: ValueParser = (value) => (value === 'True' ? { matched: true, value: true } : { matched: false });
const parseFalseLiteral: ValueParser = (value) => (value === 'False' ? { matched: true, value: false } : { matched: false });
const parseIntegerLiteral: ValueParser = (value) => (/^\d+$/.test(value) ? { matched: true, value: parseInt(value, 10) } : { matched: false });
const parseFloatLiteral: ValueParser = (value) => (/^\d*\.?\d+$/.test(value) ? { matched: true, value: parseFloat(value) } : { matched: false });
const parseSingleQuotedString: ValueParser = (value) =>
  value.startsWith("'") && value.endsWith("'") ? { matched: true, value: value.slice(1, -1) } : { matched: false };
const parseDoubleQuotedString: ValueParser = (value) =>
  value.startsWith('"') && value.endsWith('"') ? { matched: true, value: value.slice(1, -1) } : { matched: false };

/** JSON-shaped substring (a `{...}`/`[...]` value, either the whole string or embedded within it) — falls back to the raw string on a parse failure rather than throwing. */
const parseJsonLikeValue: ValueParser = (value) => {
  const looksJsonShaped =
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.includes('{') && value.includes('}')) ||
    (value.includes('[') && value.includes(']'));
  if (!looksJsonShaped) return { matched: false };
  try {
    return { matched: true, value: JSON.parse(value) as unknown };
  } catch {
    return { matched: true, value };
  }
};

const VALUE_PARSERS: readonly ValueParser[] = [
  parseNullLiteral,
  parseTrueLiteral,
  parseFalseLiteral,
  parseIntegerLiteral,
  parseFloatLiteral,
  parseSingleQuotedString,
  parseDoubleQuotedString,
  parseJsonLikeValue,
];

/** One `key=value`-style parameter value's literal-kind dispatch — tries each parser in `VALUE_PARSERS` in order, falling back to the raw string. */
function parseParameterValue(value: string): unknown {
  for (const parser of VALUE_PARSERS) {
    const result = parser(value);
    if (result.matched) return result.value;
  }
  return value;
}

interface TokenizerCharState {
  readonly inString: boolean;
  readonly stringChar: string;
  readonly depth: number;
}

/** Bracket-depth delta for one character (`+1`/`-1`/`0`) — only meaningful outside a quoted string, checked by the caller. */
function bracketDepthDelta(char: string): -1 | 0 | 1 {
  if (char === '{' || char === '[') return 1;
  if (char === '}' || char === ']') return -1;
  return 0;
}

/**
 * The quote/bracket-depth-tracking half of `splitTopLevelParams`'s
 * character loop, split out to stay under the §3.5 complexity budget:
 * entering/leaving a quoted string, or adjusting the `{}`/`[]` nesting
 * depth (bracket tracking only applies outside a string). Any other
 * character leaves `state` unchanged.
 */
function nextCharState(state: TokenizerCharState, char: string, index: number, source: string): TokenizerCharState {
  if (!state.inString && (char === '"' || char === "'")) {
    return { ...state, inString: true, stringChar: char };
  }
  if (state.inString && char === state.stringChar && source[index - 1] !== '\\') {
    return { ...state, inString: false, stringChar: '' };
  }
  if (!state.inString) {
    const delta = bracketDepthDelta(char);
    if (delta !== 0) return { ...state, depth: state.depth + delta };
  }
  return state;
}

/** True for a `,` that is neither inside a quoted string nor inside a nested `{}`/`[]` — a genuine parameter separator. */
function isTopLevelComma(state: TokenizerCharState, char: string): boolean {
  return !state.inString && char === ',' && state.depth === 0;
}

/**
 * Splits a `key=value, key2='v2', key3={...}` string on TOP-LEVEL commas
 * only — commas inside a quoted string or nested `{}`/`[]` don't split.
 */
function splitTopLevelParams(parametersString: string): string[] {
  const parts: string[] = [];
  let current = '';
  let state: TokenizerCharState = { inString: false, stringChar: '', depth: 0 };

  for (let i = 0; i < parametersString.length; i++) {
    const char = parametersString[i] as string;

    if (isTopLevelComma(state, char)) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    state = nextCharState(state, char, i, parametersString);
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parses a parameters string that isn't valid JSON on its own — the "Calling tool 'x' with parameters: k=v, k2='v2'" Python-repr'd kwargs shape. */
function parseParametersString(parametersString: string): Record<string, unknown> {
  if (parametersString.trim().startsWith('{')) {
    try {
      return JSON.parse(parametersString) as Record<string, unknown>;
    } catch {
      // fall through to manual parsing
    }
  }

  const params: Record<string, unknown> = {};
  for (const part of splitTopLevelParams(parametersString)) {
    const equalIndex = part.indexOf('=');
    if (equalIndex === -1) continue;

    const key = part.substring(0, equalIndex).trim();
    const value = part.substring(equalIndex + 1).trim();
    params[key] = parseParameterValue(value);
  }

  return params;
}

interface IndexingResultMessage {
  readonly status: string;
  readonly message: string;
}

function isIndexingResultMessage(parsed: unknown): parsed is IndexingResultMessage {
  return (
    parsed !== null &&
    typeof parsed === 'object' &&
    'status' in parsed &&
    'message' in parsed &&
    typeof (parsed as { message: unknown }).message === 'string'
  );
}

interface SkippedCategory {
  readonly name: string;
  readonly count: number;
  readonly files: readonly string[];
}

/** One "  - Category Name (5): file1.txt, file2.zip" line -> a `SkippedCategory`, or `null` when the line doesn't match the shape. */
function parseSkippedCategoryLine(line: string): SkippedCategory | null {
  const categoryMatch = /^\s*-\s+(.+?)\s+\((\d+)\):\s*(.*)$/.exec(line);
  if (!categoryMatch) return null;
  const [, name, countStr, filesStr] = categoryMatch;
  const files = filesStr
    ? filesStr
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    : [];
  return { name: name ?? '', count: parseInt(countStr ?? '0', 10), files };
}

/** Splits an indexing-result `message`'s lines into the plain summary lines and the "Skipped items (N total):" category block, if present. */
function splitIndexingResultLines(lines: readonly string[]): { readonly summaryLines: string[]; readonly skippedCategories: SkippedCategory[] } {
  const summaryLines: string[] = [];
  const skippedCategories: SkippedCategory[] = [];
  let inSkippedSection = false;

  for (const line of lines) {
    if (/^Skipped items \(\d+ total\):/.test(line)) {
      inSkippedSection = true;
      continue;
    }

    if (!inSkippedSection) {
      summaryLines.push(line);
      continue;
    }

    const category = parseSkippedCategoryLine(line);
    if (category) skippedCategories.push(category);
  }

  return { summaryLines, skippedCategories };
}

/** Formats the summary-lines block of a prettified indexing message: a status icon, then each `"Successfully indexed 40 documents."` line reformatted to `"40 documents — Successfully indexed."`. */
function formatIndexingSummary(summaryLines: readonly string[], status: string): string {
  const isNeutral = summaryLines.some((line) => /^no\s+new\b/i.test(line.trim()) || /\b0\s+\w+/i.test(line.trim()));
  const summaryIcon = status === 'error' ? '❌ ' : isNeutral ? 'ℹ️ ' : status === 'ok' ? '✅ ' : '';
  const reformatted = summaryLines.map((line) => {
    const match = /^(.+?)\s+(\d+\s+\w+)\.?\s*$/.exec(line);
    return match ? `${match[2]} — ${match[1]}` : line;
  });
  return `${summaryIcon} ${reformatted.join('\n')}`;
}

/** Formats the skipped-categories block: one `icon  N document(s) — Category` line per category, plus an indented `→ file` line per file. Categories matching `error`/`fail`/`runtime` (case-insensitive) get the failure icon, others the warning icon. */
function formatSkippedCategories(skippedCategories: readonly SkippedCategory[]): string[] {
  const output: string[] = [];
  for (const cat of skippedCategories) {
    const isError = /error|fail|runtime/i.test(cat.name);
    const icon = isError ? '❌' : '⚠️';
    output.push(`${icon}  ${cat.count} document${cat.count !== 1 ? 's' : ''} — ${cat.name}`);
    for (const file of cat.files) {
      output.push(`    → ${file}`);
    }
  }
  return output;
}

function prettifyIndexingResultMessage(parsed: IndexingResultMessage): string {
  const { status, message } = parsed;
  const lines = message.split('\n').filter(Boolean);
  if (lines.length === 0) return message;

  const { summaryLines, skippedCategories } = splitIndexingResultLines(lines);
  const output: string[] = [];

  if (summaryLines.length > 0) {
    output.push(formatIndexingSummary(summaryLines, status));
  }

  if (skippedCategories.length > 0) {
    output.push(...formatSkippedCategories(skippedCategories));
  } else if (summaryLines.length === 0) {
    if (status === 'ok') output.push('✅ Completed successfully');
    else if (status === 'error') output.push('❌ Failed');
  }

  return output.join('\n');
}

/** Attempts the "Calling tool 'x' with parameters: ..." reformat; falls back to the raw match text on a parse failure. */
function prettifyToolCallMessage(toolName: string, parametersString: string): string {
  try {
    const parameters = parseParametersString(parametersString);
    return `Calling '${toolName}' with parameters:\n\n\n${JSON.stringify(parameters, null, 2)}\n`;
  } catch {
    return `Calling '${toolName}' with parameters:\n\n${parametersString}`;
  }
}

/** A bare-JSON-object message string -> either its indexing-result summary or a fenced ```json block; `null` when `message` isn't shaped like one JSON object. */
function prettifyJsonMessage(message: string): string | null {
  const jsonMatch = /^(\{[\s\S]*\})$/.exec(message);
  if (jsonMatch?.[1] === undefined) return null;

  try {
    const parsed: unknown = JSON.parse(jsonMatch[1]);
    if (isIndexingResultMessage(parsed)) return prettifyIndexingResultMessage(parsed);
    return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return message;
  }
}

/**
 * Pretty-prints one chat message's `content`: a bare JSON object either
 * gets rendered as a fenced ```json block, or — when it looks like an
 * indexing-result payload (`{status, message}`) — reformatted into the
 * human summary `prettifyIndexingResultMessage` builds. A "Calling tool
 * 'x' with parameters: ..." message gets its Python-repr'd parameters
 * reformatted as JSON. Any other string passes through unchanged.
 */
export function prettifyToolkitMessage(message: unknown): unknown {
  if (!message || typeof message !== 'string') return message;

  const jsonResult = prettifyJsonMessage(message);
  if (jsonResult !== null) return jsonResult;

  const toolMatch = /^Calling tool '([^']+)' with parameters:\s*(.+)$/s.exec(message);
  if (toolMatch?.[1] !== undefined && toolMatch[2] !== undefined) {
    return prettifyToolCallMessage(toolMatch[1], toolMatch[2]);
  }

  return message;
}

/** Not exported: no current caller needs it apart from `ToolkitConversationMessage` below. */
interface ToolkitConversationMessageItem {
  readonly item_details: { readonly content: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface ToolkitConversationMessage {
  readonly message_items: readonly ToolkitConversationMessageItem[];
  readonly [key: string]: unknown;
}

/** Runs `prettifyToolkitMessage` over every message item's `item_details.content` in a conversation's messages, leaving everything else untouched. */
export function prettifyToolkitConversation(messages: readonly ToolkitConversationMessage[]): ToolkitConversationMessage[] {
  return messages.map((messageDetails) => ({
    ...messageDetails,
    message_items: messageDetails.message_items.map((currentMessage) => ({
      ...currentMessage,
      item_details: {
        ...currentMessage.item_details,
        content: prettifyToolkitMessage(currentMessage.item_details.content),
      },
    })),
  }));
}
