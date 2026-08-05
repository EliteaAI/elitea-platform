/**
 * Split out of `CanvasEditHeader.tsx` to stay under the file-length budget
 * (§3.5) — matches `CodeMirrorEditorHelpers.languageOptions` from the
 * baseline (`apps/elitea-ui/src/[fsd]/shared/lib/helpers/
 * codeMirrorEditor.helpers.js:63-236`).
 */

/** @public A single canvas-editor language select option. */
export interface CanvasLanguageOption {
  readonly value: string;
  readonly label: string;
}

export const CANVAS_LANGUAGE_OPTIONS: readonly CanvasLanguageOption[] = [
  { value: 'c', label: 'C' },
  { value: 'csharp', label: 'C#' },
  { value: 'c++', label: 'C++' },
  { value: 'cmake', label: 'CMake' },
  { value: 'csv', label: 'CSV' },
  { value: 'css', label: 'Css' },
  { value: 'dart', label: 'Dart' },
  { value: 'diff', label: 'Diff' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'gherkin', label: 'Feature/Gherkin' },
  { value: 'go', label: 'Go' },
  { value: 'html', label: 'Html' },
  { value: 'ini', label: 'INI' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'Java script' },
  { value: 'jsx', label: 'Jsx' },
  { value: 'jinja', label: 'Jinja2' },
  { value: 'json', label: 'Json' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'less', label: 'Less' },
  { value: 'log', label: 'Log' },
  { value: 'lua', label: 'Lua' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'perl', label: 'Perl' },
  { value: 'php', label: 'Php' },
  { value: 'properties', label: 'Properties' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'scss', label: 'Scss' },
  { value: 'shell', label: 'Shell' },
  { value: 'swift', label: 'Swift' },
  { value: 'sql', label: 'Sql' },
  { value: 'text', label: 'Text' },
  { value: 'toml', label: 'TOML' },
  { value: 'tsv', label: 'TSV' },
  { value: 'typescript', label: 'Type script' },
  { value: 'tsx', label: 'Tsx' },
  { value: 'vim', label: 'Vim' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'Yaml' },
];
