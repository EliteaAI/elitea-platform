import { useCallback, useEffect, useState } from 'react';

import { json, jsonParseLinter } from '@codemirror/lang-json';
import { type Diagnostic, linter, setDiagnostics } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { createStorage } from '@/shared/lib/storage';

/**
 * Scoped port of `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useLanguageLinter.hooks.js` (baseline, 52 lines) + the language-extension
 * half of `.../shared/lib/helpers/codeMirrorLinter.helpers.js` (baseline,
 * ~200 lines) — unit A2a. Neither file is one of this sub-unit's owned
 * old-app files (both are `shared/lib/`, unit S3's territory, and neither
 * landed there), so this is a local, scoped copy inside `features/
 * pipelines`, matching this codebase's "duplicate locally rather than reach
 * across a slice boundary" precedent — same rationale as
 * `./aiAssistantLanguage.ts`'s doc comment.
 *
 * DISCLOSED SCOPE TRIM (forced by a real, verifiable constraint — not a
 * silent reinterpretation): `codeMirrorLinter.helpers.js`'s
 * `getExtensionsByLang` covers ~14 languages, most requiring a package this
 * app's `package.json` does not install — `js-yaml` (YAML linting),
 * `markdownlint` (Markdown linting), `mermaid` (diagram linting), and
 * per-language CodeMirror grammars (`@codemirror/lang-python` etc., beyond
 * the one `@codemirror/lang-json` this app pins — confirmed via
 * `package.json`'s `@codemirror/*` block, same set `shared/ui/
 * CodeMirrorEditor.tsx`'s own doc comment already scopes to "JSON is this
 * family's only in-scope language"). Installing any of those is a
 * `package.json` change — a shared, cross-cutting file this sub-unit does
 * not own and should not edit unilaterally in a worktree shared with 27
 * sibling units. This hook therefore wires exactly 3 buckets, matching
 * `AI_PROMPT_TEMPLATES`' 7 field types (`./aiAssistantPromptTemplates.ts`)
 * — none of which is YAML, Markdown, or a mermaid diagram:
 *   - `json`  — real syntax highlighting (`@codemirror/lang-json`, already
 *     a dependency) + `jsonParseLinter()` (also already used by
 *     `CodeMirrorEditor.tsx`, so this introduces no new dependency).
 *   - `jinja` — the baseline's own `jinjaLinter` ported verbatim below
 *     (pure regex balance-checking of `{{ }}`/`{% %}`/`{# #}` — zero
 *     package dependency in the baseline either).
 *   - everything else (`text`, `python`, `code`, unknown values, …) — a
 *     no-op linter (baseline's own `textLinter`) and no syntax
 *     highlighting extension. The editor still works as a plain text
 *     editor for these; it just does not get language-aware
 *     highlighting/lint markers the missing package would have provided.
 * Any caller wiring a genuinely different language back in later should
 * extend `getExtensionsForLanguage` below, not silently widen this
 * doc-comment's claim.
 */

/**
 * Baseline key: `localStorage.getItem('EditorContentType')` (raw, global,
 * unnamespaced). Ported through `shared/lib/storage.ts`'s `el.*`-namespaced
 * wrapper instead — the ONLY file allowed to touch `localStorage` directly
 * (§5.4; `no-restricted-globals` bans it everywhere else) — under a
 * domain-scoped key, same "one function's storage, not the whole app's"
 * convention `../lib/flow-editor/helpers/pipelineCompletionSound.local.ts`
 * (a sibling A2 sub-unit) already established for the same class of
 * baseline-global-key problem.
 */
const EDITOR_CONTENT_TYPE_STORAGE_KEY = 'pipelines.ai-assistant.editor-content-type';

function readStoredContentType(): string | null {
  return createStorage('local').get(EDITOR_CONTENT_TYPE_STORAGE_KEY);
}

function writeStoredContentType(language: string): void {
  createStorage('local').set(EDITOR_CONTENT_TYPE_STORAGE_KEY, language);
}

/**
 * Ported verbatim from `codeMirrorLinter.helpers.js`'s `jinjaLinter`
 * (baseline lines 71-113) — balanced-delimiter checking for Jinja2's
 * `{{ }}` / `{% %}` / `{# #}` syntax, no external package.
 */
const jinjaLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  const doc = view.state.doc.toString();

  const openTags = (doc.match(/{%/g) ?? []).length;
  const closeTags = (doc.match(/%}/g) ?? []).length;
  if (openTags !== closeTags) {
    diagnostics.push({
      from: 0,
      to: doc.length,
      severity: 'error',
      message: 'Unmatched Jinja2 tags: {% and %} must be balanced.',
    });
  }

  const openBraces = (doc.match(/{{/g) ?? []).length;
  const closeBraces = (doc.match(/}}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    diagnostics.push({
      from: 0,
      to: doc.length,
      severity: 'error',
      message: 'Unmatched Jinja2 variable braces: {{ and }} must be balanced.',
    });
  }

  const openComments = (doc.match(/{#/g) ?? []).length;
  const closeComments = (doc.match(/#}/g) ?? []).length;
  if (openComments !== closeComments) {
    diagnostics.push({
      from: 0,
      to: doc.length,
      severity: 'error',
      message: 'Unmatched Jinja2 comments: {# and #} must be balanced.',
    });
  }

  const invalidSyntax = doc.match(/{%.*?[^%]}/g);
  if (invalidSyntax) {
    for (const match of invalidSyntax) {
      const start = doc.indexOf(match);
      diagnostics.push({
        from: start,
        to: start + match.length,
        severity: 'warning',
        message: `Potential invalid syntax: "${match}"`,
      });
    }
  }

  return diagnostics;
});

const textLinter = linter(() => []);

interface LanguageExtensionBucket {
  readonly extensionWithLinter: Extension[];
  readonly extensionWithoutLinter: Extension[];
}

function getExtensionsForLanguage(language: string): LanguageExtensionBucket {
  if (language === 'json') {
    return { extensionWithoutLinter: [json()], extensionWithLinter: [json(), linter(jsonParseLinter())] };
  }
  if (language === 'jinja') {
    return { extensionWithoutLinter: [], extensionWithLinter: [jinjaLinter] };
  }
  return { extensionWithoutLinter: [], extensionWithLinter: [textLinter] };
}

export interface UseAiAssistantLanguageLinterResult {
  readonly extensions: Extension[];
  readonly onChangeLanguage: (newLanguage: string) => void;
  readonly language: string;
}

/**
 * Owns the AI Assistant editor's current "language" (content-type) state
 * and the CodeMirror `Extension[]` that go with it, swapping to the
 * lint-free bucket while `isGenerating` (streamed, necessarily-incomplete
 * content should not be linted mid-stream — same reasoning the baseline's
 * own `isGenerating` branch documents).
 */
export function useAiAssistantLanguageLinter(
  defaultLanguage: string | undefined,
  editorView: EditorView | null | undefined,
  isGenerating = false,
): UseAiAssistantLanguageLinterResult {
  const [language, setLanguage] = useState<string>(() => defaultLanguage || readStoredContentType() || 'text');
  const [extensions, setExtensions] = useState<Extension[]>(
    () => getExtensionsForLanguage(defaultLanguage || readStoredContentType() || 'text').extensionWithLinter,
  );

  useEffect(() => {
    const { extensionWithLinter, extensionWithoutLinter } = getExtensionsForLanguage(language);
    setExtensions(isGenerating ? extensionWithoutLinter : extensionWithLinter);
  }, [isGenerating, language]);

  const onChangeLanguage = useCallback(
    (newLanguage: string) => {
      writeStoredContentType(newLanguage);
      if (editorView) editorView.dispatch(setDiagnostics(editorView.state, []));
      setLanguage(newLanguage);
    },
    [editorView],
  );

  return { extensions, onChangeLanguage, language };
}
