import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';

/**
 * Scoped port of `apps/elitea-ui/src/[fsd]/shared/lib/helpers/
 * codeMirrorLinter.helpers.js`'s `getExtensionsByLang` (317 lines) — used by
 * `ToolBaseProperty.tsx` for a `code_language`-tagged string field
 * (`ToolBaseProperty.jsx:453-470`).
 *
 * **REAL, DISCLOSED SCOPE GAP, not a porting shortcut.** The baseline
 * dynamically `import()`s a distinct CodeMirror language package per branch
 * of a ~40-case switch (`@codemirror/lang-python`, `@codemirror/lang-yaml`
 * via `@codemirror/legacy-modes`, `@uiw/codemirror-extensions-langs`,
 * `markdownlint/sync`, plus hand-rolled StreamLanguage modes for csv/tsv/
 * diff, and linters for yaml/jinja/mermaid/markdown). This app's
 * `package.json` (checked live at port time: `grep -E "codemirror|@uiw"
 * package.json`) installs exactly ONE CodeMirror language package —
 * `@codemirror/lang-json` — the rest of that dependency tree does not exist
 * in this app and adding ~15 new packages is outside a settings-form
 * sub-unit's scope (dependency additions are a toolchain-level decision,
 * spec §2.5). `json` therefore gets real syntax highlighting + linting,
 * exactly like the baseline; every other `code_language` value falls back
 * to a plain, unhighlighted (but fully functional — typing, editing,
 * resizing, fullscreen all still work via `ResizableCodeMirrorEditor`) text
 * editor, matching the baseline's own `default:`/`'text'` case shape. A
 * future `shared/lib` unit that adds the missing language packages can
 * replace this file's `default` branch without any `ToolBaseProperty.tsx`
 * call-site change — `getCodeLanguageExtensions`'s signature already
 * matches the baseline's.
 */
export function getCodeLanguageExtensions(codeLanguage: string | undefined): readonly Extension[] {
  if (codeLanguage === 'json') {
    return [json(), linter(jsonParseLinter())];
  }
  return [];
}
