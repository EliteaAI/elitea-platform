/**
 * CodeMirror extensions for the canvas editor's selected language.
 *
 * ── DISCLOSED SCOPE LIMIT, stated rather than hidden ─────────────────────
 * `canvasLanguageOptions.ts` offers 43 languages. This app installs exactly
 * ONE CodeMirror language package — `@codemirror/lang-json` — so only JSON
 * gets syntax highlighting and linting. The other 42 render in a plain,
 * fully-functional text editor: typing, editing, undo/redo, copy, remote
 * sync and the language select all work; only the colouring is missing.
 *
 * Closing that gap means adding roughly fifteen `@codemirror/lang-*`
 * packages (plus `@codemirror/legacy-modes` and
 * `@uiw/codemirror-extensions-langs` for the long tail), which is a
 * dependency decision, not an editor-wiring one, and is deliberately NOT
 * taken here.
 *
 * `features/toolkits/ui/form/ToolBase/codeLanguageExtensions.ts` reached the
 * same conclusion for the same reason. It is duplicated rather than imported
 * because `.dependency-cruiser.cjs`'s `no-deep-slice-import-cross-slice`
 * forbids reaching into another slice's internals, and neither slice's
 * `index.ts` exports it. The two copies are four lines each; the shared
 * thing worth extracting is the language-package set, once it exists.
 */
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';

export function getCanvasCodeExtensions(codeLanguage: string | undefined): Extension[] {
  if (codeLanguage === 'json') {
    return [json(), linter(jsonParseLinter())];
  }
  return [];
}
