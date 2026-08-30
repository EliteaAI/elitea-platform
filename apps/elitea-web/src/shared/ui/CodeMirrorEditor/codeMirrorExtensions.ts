/**
 * Two CodeMirror extension builders, split out of `CodeMirrorEditor.tsx` to
 * keep that file under the §3.5 400-line budget. Pure functions — the
 * component memoises the calls itself.
 */
import { type Diagnostic, forEachDiagnostic, setDiagnosticsEffect } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';


/**
 * One CodeMirror 6 `Diagnostic`, narrowed to the plain-data fields
 * `onSyntaxError` reports (no `renderMessage`/`actions` callbacks).
 *
 * Declared HERE, next to the listener that produces it, and re-exported by
 * `CodeMirrorEditor.tsx` for callers. It used to live in the component file,
 * which made the two modules import each other — a cycle
 * `.dependency-cruiser.cjs`'s `no-circular` rightly refuses.
 */
export interface CodeMirrorSyntaxError {
  from: number;
  to: number;
  severity: Diagnostic['severity'];
  message: string;
  source: string | undefined;
}

/** `EditorState.transactionFilter` truncating any edit that would push the doc past `maxLength`, preserving the cursor. Ported verbatim from baseline `CodeMirrorEditor.jsx`'s `createMaxLengthExtension`. */
export function createMaxLengthExtension(maxLength: number): Extension {
  if (maxLength <= 0) return [];
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (tr.newDoc.length <= maxLength) return tr;
    const truncated = tr.newDoc.sliceString(0, maxLength);
    const selection = tr.selection ?? tr.startState.selection;
    const cursor = Math.min(selection.main.head, truncated.length);
    return tr.startState.update({
      changes: { from: 0, to: tr.startState.doc.length, insert: truncated },
      selection: { anchor: cursor },
    });
  });
}

export function buildSyntaxErrorListener(
  onSyntaxError: ((errors: CodeMirrorSyntaxError[]) => void) | undefined,
): Extension[] {
  if (!onSyntaxError) return [];
    return [
      EditorView.updateListener.of((update) => {
        // A `linter()` extension (§ doc comment above) runs on its own
        // idle-delay timer (`LintConfig.delay`, 750ms default) and reports
        // its result via a `setDiagnosticsEffect` transaction that has
        // `docChanged: false` — it is not itself an edit. Guarding on
        // `docChanged` alone (baseline's condition, once its own read bug is
        // fixed) means this listener fires immediately after every
        // keystroke, before the linter has run, sees no diagnostics yet, and
        // reports `[]` — then never fires again once the real diagnostics
        // land, because that update doesn't change the doc. Confirmed with a
        // throwaway spike test against this exact linter/version before
        // writing this fix: without it, `onSyntaxError` is called with `[]`
        // once per keystroke and never again with the actual error.
        // `viewportChanged` (baseline's other guard branch) is unrelated to
        // diagnostics — scrolling does not change lint results — and is
        // dropped rather than ported.
        const diagnosticsChanged = update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
        );
        if (!update.docChanged && !diagnosticsChanged) return;
        const errors: CodeMirrorSyntaxError[] = [];
        forEachDiagnostic(update.state, (diagnostic) => {
          errors.push({
            from: diagnostic.from,
            to: diagnostic.to,
            severity: diagnostic.severity,
            message: diagnostic.message,
            source: diagnostic.source,
          });
        });
        onSyntaxError(errors);
      }),
    ];
}

