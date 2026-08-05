/**
 * Content-type ("language") detection and the language picker's option
 * list for the AI Assistant editor (unit A2a).
 *
 * `AI_ASSISTANT_LANGUAGE_OPTIONS` is ported verbatim from `apps/elitea-ui/
 * src/[fsd]/shared/lib/helpers/codeMirrorEditor.helpers.js`'s
 * `languageOptions` (baseline, lines 63-236) — the full 43-entry list, so
 * the content-type DROPDOWN still offers every option the baseline did (a
 * caller can still manually pick any of them).
 *
 * `detectContentType` is NOT a verbatim port. Not one of this sub-unit's
 * owned old-app files (`codeMirrorEditor.helpers.js` is `shared/lib/`,
 * unit S3's territory, and neither landed there — see this file's earlier
 * revision for the "duplicate locally" precedent this still follows), and
 * the baseline's own `detectContentType` (lines 239-789, a ~40-branch
 * scoring heuristic covering CSV/TSV/Kotlin/Dart/Vue/CSS family/Mermaid/
 * diff/13 general-purpose languages) has a measured cyclomatic complexity
 * far past oxlint's `complexity: 12` budget (§3.5) even after splitting
 * across helper functions — the baseline's markdown-vs-YAML scoring alone
 * is ~30 independent boolean conditions in two functions. DISCLOSED SCOPE
 * REDUCTION (real, not silent): this port keeps 5 low-complexity checks —
 * `json` (strict `JSON.parse`, matching the baseline's own strict check),
 * `jinja`, `yaml`, `markdown` (each a handful of clear structural markers,
 * not baseline's weighted scoring), and `python` (a handful of keyword
 * checks) — covering every content type `AI_PROMPT_TEMPLATES`' 7 field
 * types (`./aiAssistantPromptTemplates.ts`: system/task/code/router/
 * template/decision/final_message — prompt text, Python code, a routing
 * condition, a Jinja2 template) can actually produce. Everything else
 * (C/C++/C#/Java/Go/Rust/Swift/Ruby/PHP/SQL/Kotlin/Dart/HTML/XML/CSS
 * family/Mermaid/diff/CSV/TSV) falls through to `'text'` — the dropdown
 * still lists all of them for a MANUAL pick (this is a detector, not a
 * validator); this only affects the AUTO-detected initial guess, exactly
 * the same reduced-support boundary `../model/useAiAssistantLanguageLinter.ts`
 * already documents for the LINTER half of language support.
 */

/** One entry in the AI Assistant editor's content-type dropdown. */
export interface AiAssistantLanguageOption {
  readonly label: string;
  readonly value: string;
}

/* eslint-disable no-useless-escape */
export const AI_ASSISTANT_LANGUAGE_OPTIONS: readonly AiAssistantLanguageOption[] = [
  { label: 'C', value: 'c' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'c++' },
  { label: 'CMake', value: 'cmake' },
  { label: 'CSV', value: 'csv' },
  { label: 'Css', value: 'css' },
  { label: 'Dart', value: 'dart' },
  { label: 'Diff', value: 'diff' },
  { label: 'Dockerfile', value: 'dockerfile' },
  { label: 'Feature/Gherkin', value: 'gherkin' },
  { label: 'Go', value: 'go' },
  { label: 'Html', value: 'html' },
  { label: 'INI', value: 'ini' },
  { label: 'Java', value: 'java' },
  { label: 'Java script', value: 'javascript' },
  { label: 'Jsx', value: 'jsx' },
  { label: 'Jinja2', value: 'jinja' },
  { label: 'Json', value: 'json' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Less', value: 'less' },
  { label: 'Log', value: 'log' },
  { label: 'Lua', value: 'lua' },
  { label: 'Makefile', value: 'makefile' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'Mermaid', value: 'mermaid' },
  { label: 'Perl', value: 'perl' },
  { label: 'Php', value: 'php' },
  { label: 'Properties', value: 'properties' },
  { label: 'Python', value: 'python' },
  { label: 'Rust', value: 'rust' },
  { label: 'Ruby', value: 'ruby' },
  { label: 'Scss', value: 'scss' },
  { label: 'Shell', value: 'shell' },
  { label: 'Swift', value: 'swift' },
  { label: 'Sql', value: 'sql' },
  { label: 'Text', value: 'text' },
  { label: 'TOML', value: 'toml' },
  { label: 'TSV', value: 'tsv' },
  { label: 'Type script', value: 'typescript' },
  { label: 'Tsx', value: 'tsx' },
  { label: 'Vim', value: 'vim' },
  { label: 'XML', value: 'xml' },
  { label: 'Yaml', value: 'yaml' },
];

function looksLikeJson(trimmed: string): boolean {
  const bounded = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!bounded) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeJinja(trimmed: string): boolean {
  const hasVariable = trimmed.includes('{{') && trimmed.includes('}}');
  const hasTag = trimmed.includes('{%') && trimmed.includes('%}');
  const hasComment = trimmed.includes('{#') && trimmed.includes('#}');
  return hasVariable || hasTag || hasComment;
}

const YAML_DOCUMENT_MARKERS: readonly RegExp[] = [/^---\s*$/m, /^\.\.\.\s*$/m];
const YAML_KEY_VALUE_LINE = /^[a-zA-Z_][\w-]*:\s?\S/;

function looksLikeYaml(trimmed: string): boolean {
  if (YAML_DOCUMENT_MARKERS.some((pattern) => pattern.test(trimmed))) return true;

  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;

  const keyValueLines = lines.filter((line) => YAML_KEY_VALUE_LINE.test(line.trim()) && !line.includes('://'));
  return keyValueLines.length / lines.length > 0.6;
}

const MARKDOWN_MARKERS: readonly RegExp[] = [/^#{1,6}\s+\S/m, /```/, /^\s*[-*+]\s+\S/m, /\[.+\]\(.+\)/, /^\s*>\s?\S/m];

function looksLikeMarkdown(trimmed: string): boolean {
  return MARKDOWN_MARKERS.some((pattern) => pattern.test(trimmed));
}

const PYTHON_MARKERS: readonly string[] = ['def ', 'class ', 'import ', 'from ', 'print(', 'if __name__', 'elif ', 'self.'];

function looksLikePython(trimmed: string): boolean {
  if (trimmed.startsWith('#!') && trimmed.slice(0, 40).includes('python')) return true;
  return PYTHON_MARKERS.some((marker) => trimmed.includes(marker));
}

/**
 * Best-effort content-type guess for the initial value shown in the AI
 * Assistant editor. See this file's own header for the disclosed scope
 * reduction versus the baseline's exhaustive heuristic.
 */
export function detectContentType(content: string | null | undefined): string {
  if (!content) return 'text';
  const trimmed = content.trim();
  if (!trimmed) return 'text';

  if (looksLikeJson(trimmed)) return 'json';
  if (looksLikeJinja(trimmed)) return 'jinja';
  if (looksLikePython(trimmed)) return 'python';
  if (looksLikeYaml(trimmed)) return 'yaml';
  if (looksLikeMarkdown(trimmed)) return 'markdown';

  return 'text';
}
