import { forEachDiagnostic, forceLinting } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { createYamlLinter, YAML_ERROR_MARK_CLASS } from './yamlLint';

installCodeMirrorTestPolyfills();

interface CollectedDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: string;
  markClass: string | undefined;
}

function mountEditor(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state: EditorState.create({ doc, extensions: [createYamlLinter()] }), parent });
}

function collectDiagnostics(view: EditorView): CollectedDiagnostic[] {
  const diagnostics: CollectedDiagnostic[] = [];
  forEachDiagnostic(view.state, (d) => {
    diagnostics.push({ from: d.from, to: d.to, message: d.message, severity: d.severity, markClass: d.markClass });
  });
  return diagnostics;
}

/**
 * `forceLinting` (`@codemirror/lint`'s own source, `dist/index.js`'s
 * `lintPlugin.run()`) always wraps even a fully synchronous linter source in
 * `Promise.resolve(source(view)).then(...)` before dispatching
 * `setDiagnostics` -- so diagnostics never land in `view.state` in the same
 * microtask `forceLinting` returns in, even though `createYamlLinter`'s own
 * source function itself runs synchronously. One microtask tick is exactly
 * what that `.then` chain needs (traced against the installed
 * `@codemirror/lint@6.9.7` source: `Promise.resolve(array).then(...)` inside
 * `batchResults`, whose own `sink` call — the `view.dispatch(setDiagnostics
 * (...))` — is synchronous once that `.then` fires), so awaiting a single
 * already-resolved `Promise.resolve()` flushes it deterministically.
 */
async function forceLintingAndFlush(view: EditorView): Promise<void> {
  forceLinting(view);
  await Promise.resolve();
}

describe('createYamlLinter', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it('reports no diagnostics for valid YAML', async () => {
    view = mountEditor('a: b\nc: d');
    await forceLintingAndFlush(view);
    expect(collectDiagnostics(view)).toEqual([]);
  });

  it('reports one error diagnostic for invalid YAML, marked with the baseline error class, spanning the offending line', async () => {
    view = mountEditor('a: [');
    await forceLintingAndFlush(view);
    const diagnostics = collectDiagnostics(view);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      from: 0,
      to: 4,
      severity: 'error',
      markClass: YAML_ERROR_MARK_CLASS,
    });
    expect(diagnostics[0]?.message).toMatch(/flow collection/);
  });

  it('re-lints to clear once the document is fixed back to valid YAML', async () => {
    view = mountEditor('a: [');
    await forceLintingAndFlush(view);
    expect(collectDiagnostics(view)).toHaveLength(1);

    view.dispatch({ changes: { from: 0, to: 4, insert: 'a: b' } });
    await forceLintingAndFlush(view);
    expect(collectDiagnostics(view)).toEqual([]);
  });

  it('flags a second, differently-shaped invalid document on a fresh editor', async () => {
    // A duplicated-mapping-key-adjacent indentation error rather than an
    // unterminated flow collection -- confirms the linter is not narrowly
    // coupled to one specific `js-yaml` failure shape.
    view = mountEditor('a: b\n  c: d');
    await forceLintingAndFlush(view);
    const diagnostics = collectDiagnostics(view);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });
});
