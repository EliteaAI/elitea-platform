import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forEachDiagnostic, forceLinting } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';

import { installWebStorageShim } from '../../../test/webstorage';

import { useAiAssistantLanguageLinter } from './useAiAssistantLanguageLinter';

installWebStorageShim();
installCodeMirrorTestPolyfills();

interface CollectedDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: string;
}

function mountJinjaEditor(doc: string): EditorView {
  const { result } = renderHook(() => useAiAssistantLanguageLinter('jinja', null, false));
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state: EditorState.create({ doc, extensions: result.current.extensions }), parent });
}

function collectDiagnostics(view: EditorView): CollectedDiagnostic[] {
  const diagnostics: CollectedDiagnostic[] = [];
  forEachDiagnostic(view.state, (d) => {
    diagnostics.push({ from: d.from, to: d.to, message: d.message, severity: d.severity });
  });
  return diagnostics;
}

/** Same reasoning as `lib/yamlLint.test.ts`'s own `forceLintingAndFlush` — `forceLinting` always defers its `setDiagnostics` dispatch through one microtask, even for a fully synchronous lint source. */
async function forceLintingAndFlush(view: EditorView): Promise<void> {
  forceLinting(view);
  await Promise.resolve();
}

describe('useAiAssistantLanguageLinter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initializes language from defaultLanguage when supplied', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('json', null, false));
    expect(result.current.language).toBe('json');
  });

  it('falls back to the persisted content-type, then "text"', () => {
    localStorage.setItem('el.pipelines.ai-assistant.editor-content-type', 'jinja');
    const { result } = renderHook(() => useAiAssistantLanguageLinter(undefined, null, false));
    expect(result.current.language).toBe('jinja');
  });

  it('falls back to "text" when nothing else is set', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter(undefined, null, false));
    expect(result.current.language).toBe('text');
  });

  it('produces a non-empty extensions array for json (highlighting + linter)', async () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('json', null, false));
    await waitFor(() => expect(result.current.extensions.length).toBeGreaterThan(0));
  });

  it('drops the json syntax-highlighting/linter bundle down to the plain highlight-free bucket while isGenerating', async () => {
    const { result, rerender } = renderHook(({ isGenerating }) => useAiAssistantLanguageLinter('json', null, isGenerating), {
      initialProps: { isGenerating: false },
    });
    await waitFor(() => expect(result.current.extensions.length).toBe(2)); // json() + linter(jsonParseLinter())

    rerender({ isGenerating: true });

    await waitFor(() => expect(result.current.extensions.length).toBe(1)); // json() only, linter dropped
  });

  it('produces an empty extensions array for text while isGenerating (linter suppressed)', async () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, true));
    await waitFor(() => expect(result.current.extensions).toEqual([]));
  });

  it('routes "python" (the Code node\'s AI-Assistant `language` override) to the same no-highlight bucket as "text"', async () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('python', null, false));
    expect(result.current.language).toBe('python');
    // Text-linter only (no syntax-highlighting extension) — real Python highlighting
    // needs `@codemirror/lang-python`, not an installed dependency; see the hook's
    // own header doc comment.
    await waitFor(() => expect(result.current.extensions.length).toBe(1));

    const { result: textResult } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
    await waitFor(() => expect(textResult.current.extensions.length).toBe(result.current.extensions.length));
  });

  it('onChangeLanguage updates language and persists to storage', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
    result.current.onChangeLanguage('jinja');
    expect(localStorage.getItem('el.pipelines.ai-assistant.editor-content-type')).toBe('jinja');
  });

  it('onChangeLanguage clears diagnostics on the supplied editor view', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'abc' }) });
    const dispatchSpy = vi.spyOn(view, 'dispatch');
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', view, false));

    result.current.onChangeLanguage('json');

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('does not throw when editorView is null on language change', () => {
    const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
    expect(() => result.current.onChangeLanguage('json')).not.toThrow();
  });

  describe('the jinja linter extension', () => {
    let view: EditorView | undefined;

    afterEach(() => {
      view?.destroy();
      view = undefined;
    });

    it('reports no diagnostics for balanced, valid jinja', async () => {
      // A single {% %} pair with no other tag mixed in — chosen to avoid the ported
      // `invalidSyntax` regex's own documented (baseline-verbatim) false-positive: it can
      // span across separate {% %}/{# #} groups looking for a "}" not preceded by "%".
      view = mountJinjaEditor('{% if x %}yes{% endif %}');
      await forceLintingAndFlush(view);
      expect(collectDiagnostics(view)).toEqual([]);
    });

    it('reports an error for unbalanced {% %} tags', async () => {
      // The linter counts raw "{%"/"%}" substring occurrences, not proper nesting — two opens,
      // one close is what actually trips the mismatch (a single "{% if x %}yes" is balanced:
      // one "{%" and one "%}").
      view = mountJinjaEditor('{% if x %}{% for y in z');
      await forceLintingAndFlush(view);
      const diagnostics = collectDiagnostics(view);
      expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('{% and %}') as unknown }));
    });

    it('reports an error for unbalanced {{ }} braces', async () => {
      view = mountJinjaEditor('{{ name');
      await forceLintingAndFlush(view);
      const diagnostics = collectDiagnostics(view);
      expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('{{ and }}') as unknown }));
    });

    it('reports an error for unbalanced {# #} comments', async () => {
      view = mountJinjaEditor('{# a comment');
      await forceLintingAndFlush(view);
      const diagnostics = collectDiagnostics(view);
      expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('{# and #}') as unknown }));
    });

    it('reports a warning for a tag closed with a single "}" instead of "%}"', async () => {
      view = mountJinjaEditor('{% if x }');
      await forceLintingAndFlush(view);
      const diagnostics = collectDiagnostics(view);
      expect(diagnostics.some((d) => d.severity === 'warning' && d.message.includes('Potential invalid syntax'))).toBe(true);
    });

    it('the no-op text linter (for "text"/other unknown languages) reports no diagnostics', async () => {
      const { result } = renderHook(() => useAiAssistantLanguageLinter('text', null, false));
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      view = new EditorView({ state: EditorState.create({ doc: 'plain text, no markup', extensions: result.current.extensions }), parent });
      await forceLintingAndFlush(view);
      expect(collectDiagnostics(view)).toEqual([]);
    });

    it('re-lints to clear once the document becomes balanced again', async () => {
      view = mountJinjaEditor('{{ name');
      await forceLintingAndFlush(view);
      expect(collectDiagnostics(view).length).toBeGreaterThan(0);

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{{ name }}' } });
      await forceLintingAndFlush(view);
      expect(collectDiagnostics(view)).toEqual([]);
    });
  });
});
