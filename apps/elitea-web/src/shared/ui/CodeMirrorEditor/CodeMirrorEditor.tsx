import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Diagnostic, forEachDiagnostic, lintGutter, setDiagnosticsEffect } from '@codemirror/lint';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useTheme } from '@mui/material/styles';
import CodeMirror, { basicSetup } from '@uiw/react-codemirror';

/** One CodeMirror 6 `Diagnostic`, narrowed to the plain-data fields `onSyntaxError` reports (no `renderMessage`/`actions` callbacks). */
export interface CodeMirrorSyntaxError {
  from: number;
  to: number;
  severity: Diagnostic['severity'];
  message: string;
  source: string | undefined;
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CodeMirrorEditorProps {
  /** Document text. */
  value: string;
  /** Fires ~30ms after the last keystroke (debounced, matching baseline's `notifyChange` — avoids flooding a form-level store on every keypress). */
  onChange?: (value: string) => void;
  /** Fires the current document text on blur. */
  onBlur?: (value: string) => void;
  /** Extra CodeMirror extensions — language support, a `linter()`, etc. */
  extensions?: Extension[];
  // Explicit `| undefined`: callers commonly forward an already-optional
  // `meta.disabled`-shaped value straight through (e.g.
  // `CommonStringField`'s code-language branch) — under
  // `exactOptionalPropertyTypes`, a plain `readOnly?: boolean` target
  // rejects that `boolean | undefined` value even though omitting the prop
  // entirely is fine. Same fix as `FieldHeaderProps`.
  readOnly?: boolean | undefined;
  /** Hard character cap; further input past this length is rejected in place. */
  maxLength?: number;
  height?: string;
  minHeight?: string;
  /** Diagnostics from any `linter()` extension in `extensions`, re-reported on every doc/viewport update. */
  onSyntaxError?: (errors: CodeMirrorSyntaxError[]) => void;
  'aria-label'?: string;
}

const CHANGE_DEBOUNCE_MS = 30;

/** `EditorState.transactionFilter` truncating any edit that would push the doc past `maxLength`, preserving the cursor. Ported verbatim from baseline `CodeMirrorEditor.jsx`'s `createMaxLengthExtension`. */
function createMaxLengthExtension(maxLength: number): Extension {
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

/**
 * A CodeMirror 6 text editor. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/CodeMirrorEditor.jsx` +
 * `.../shared/lib/hooks/useCodeMirror.hooks.js` — the baseline was already
 * CodeMirror 6 (`@uiw/react-codemirror@^4.23.10` over `codemirror@^6.0.1`,
 * same major line as this app's `@uiw/react-codemirror@4.25.11` / CM6
 * 6.37→6.43 packages), not the legacy CM5 imperative API, so this is a
 * same-major-version port, not a cross-major rewrite.
 *
 * Two real API-mismatch defects found while porting (exactly the class of
 * risk CodeMirror 6 was flagged as highest-risk for) and fixed here rather
 * than carried over:
 *
 * 1. **Baseline's `onSyntaxError` listener never actually read diagnostics.**
 *    It called `update.state.field(lintGutter, false)` — but `lintGutter` is
 *    the *extension-constructor function* exported by `@codemirror/lint`
 *    (`(config?) => Extension`), not a `StateField` instance.
 *    `EditorState.field()` requires an actual `StateField` object; hooking a
 *    function through with `required=false` returns `undefined` every time
 *    (verified against `node_modules/@codemirror/lint`'s `.d.ts` — the
 *    correct read API is the module's own exported
 *    `forEachDiagnostic(state, callback)`). The baseline's `onSyntaxError`
 *    callers therefore only ever received `[]`, silently. Fixed below by
 *    using `forEachDiagnostic` — and, once that read was fixed, a second,
 *    previously-invisible bug surfaced behind it: baseline's listener only
 *    re-runs on `docChanged || viewportChanged`, but `linter()` reports its
 *    (async, delayed) result via a separate `setDiagnosticsEffect`
 *    transaction that changes neither. See the inline comment at the
 *    listener below for how this is verified and fixed.
 * 2. **Baseline's `onBlur` forwarded the raw `FocusEvent`, not the edited
 *    value.** `CodeMirrorEditor.jsx` passes its `onBlur` prop straight
 *    through to `<CodeMirror onBlur={onBlur}>`, whose `onBlur` is a normal
 *    `React.FocusEventHandler<HTMLDivElement>` (`ReactCodeMirrorProps`
 *    extends `Omit<HTMLAttributes<HTMLDivElement>, 'onChange'|'placeholder'>`
 *    — `onBlur` is not one of the overridden keys). But baseline
 *    `CommonStringField.jsx` calls it as
 *    `onBlur={value => handleCodeFieldChange(fieldKey, value)}`, i.e. it
 *    expects the *string value*, not a `FocusEvent`. This component's
 *    `onBlur` prop is typed and implemented as `(value: string) => void` —
 *    the call site's actual expectation — by wrapping CodeMirror's native
 *    blur event internally instead of forwarding it.
 *
 * Scope trims versus the baseline (none of this unit's 9 in-scope call
 * sites — `ResizableCodeMirrorEditor`, `CommonStringField` — use any of
 * these):
 *  - No imperative ref API (`getCode`/`setCode`/`undo`/`redo`/`editor`/
 *    `view`/`state`) — the baseline exposed one via `forwardRef` +
 *    `useImperativeHandle`, but neither in-scope caller ever attaches a
 *    ref to it.
 *  - No `onCanUndo`/`onCanRedo`/`onKeyDown`/`autoHeight`/`maxHeight`/
 *    `width`/`minWidth`/`maxWidth`/`variant` props — unused by every
 *    in-scope caller; `variant` is fixed to `'bodyMedium'` (the baseline's
 *    own default, and the only value any in-scope caller ever needs).
 *  - No custom `foldByIndent` (baseline's
 *    `codeMirrorEditor.helpers.js#foldByIndent`, via `@codemirror/language`'s
 *    `foldService`) — `@codemirror/language` was not among the six
 *    `@codemirror/*` packages already pinned in `package.json` for this
 *    batch, and folding still works for JSON (this family's only in-scope
 *    language) via `@codemirror/lang-json`'s own syntax-tree fold info
 *    through `basicSetup({ foldGutter: true })`.
 *  - No `@uiw/codemirror-theme-vscode` (`vscodeDarkInit`/`vscodeLightInit`)
 *    — not an installed dependency, and baseline's `isDarkMode` JS branch to
 *    pick between the two is exactly what `elitea/no-mode-branch` (R-T2)
 *    bans app-wide. Colour theming below reads `theme.vars.palette.*`
 *    exclusively, which are live CSS-variable references (R-T7) — the
 *    editor repaints for the current colour scheme via the CSS cascade,
 *    with no JS mode branch and no extra dependency.
 *
 * Also fixed without being asked (found while porting, not a listed
 * baseline behaviour): baseline's `<CodeMirror>` never set its own
 * `basicSetup` prop, which defaults to `true` — i.e. it rendered the
 * *default* `basicSetup()` bundle AND `useCodeMirror`'s separately
 * hand-configured `basicSetup({ foldGutter: false, ... })`, registering the
 * whole basic-setup extension bundle (including a second copy of
 * `historyKeymap`/`searchKeymap`/etc.) twice. This port passes
 * `basicSetup={false}` to `<CodeMirror>` and supplies exactly one
 * `basicSetup(...)` call, configured explicitly (history/searchKeymap
 * disabled there since both are wired individually below, matching the
 * baseline's evident intent of customising them).
 */
export function CodeMirrorEditor({
  value,
  onChange,
  onBlur,
  extensions: extensionsProp,
  readOnly = false,
  maxLength = 0,
  height = 'calc(100vh - 220px)',
  minHeight = 'calc(100vh - 220px)',
  onSyntaxError,
  'aria-label': ariaLabel,
}: CodeMirrorEditorProps): ReactNode {
  const theme = useTheme();
  const [code, setCode] = useState(value);
  const lastNotifiedValueRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (value !== lastNotifiedValueRef.current) {
      setCode(value);
      lastNotifiedValueRef.current = value;
    }
  }, [value]);

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleChange = useCallback(
    (newValue: string) => {
      setCode(newValue);
      if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastNotifiedValueRef.current = newValue;
        onChange?.(newValue);
      }, CHANGE_DEBOUNCE_MS);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    onBlur?.(code);
  }, [code, onBlur]);

  const editorTheme = useMemo(() => {
    const typography = theme.typography.bodyMedium;
    // `TypographyVariants['bodyMedium']` is a plain `CSSProperties`, so every
    // member is optional (`string | number | undefined`); CM6's `StyleSpec`
    // rejects `undefined` outright (only `string | number | StyleSpec |
    // null`). Falling back to the base `theme.typography.*` scale (which
    // MUI types as always-defined) resolves every member to a concrete
    // `string`/`number` for the type checker, not just at runtime.
    // `theme.typography.fontFamily` is itself typed `CSSProperties['fontFamily']`
    // (MUI's `createTypography.d.ts`), i.e. `string | undefined` too — a
    // real theme always sets it, but the type checker doesn't know that, so
    // the fallback chain needs a literal at the end to land on `string`.
    const fontFamily: string = typography.fontFamily ?? theme.typography.fontFamily ?? 'inherit';
    const fontSize: string | number = typography.fontSize ?? theme.typography.fontSize;
    const lineHeight: string | number = typography.lineHeight ?? theme.typography.body1.lineHeight ?? 1.5;
    return EditorView.theme({
      '&': {
        backgroundColor: theme.vars.palette.background.codeMirrorEditor,
      },
      '.cm-content': {
        fontFamily,
        fontSize,
        lineHeight,
        // Base colour for any character `highlightStyle` below doesn't tag
        // (whitespace, unmatched punctuation) — without this, `theme="none"`
        // (see the `<CodeMirror>` prop below) leaves it at the browser
        // default instead of a token paired with this same background.
        color: theme.vars.palette.text.primary,
        caretColor: theme.vars.palette.text.primary,
      },
      '.cm-gutters': {
        backgroundColor: theme.vars.palette.background.tabPanel,
        color: theme.vars.palette.text.secondary,
        border: 'none',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: theme.vars.palette.background.tabPanel,
      },
      '.cm-editor': {
        borderRadius: theme.vars.shape.radiusSm,
      },
      '&.cm-focused': {
        outline: 'none',
      },
    });
  }, [theme]);

  // Neither `<CodeMirror theme="light">` (CM6's own bundled light base — it
  // only sets background/selection/cursor colours, no syntax colours) nor
  // `basicSetup`'s `defaultHighlightStyle` fallback (from `@codemirror/
  // language`, pulled in automatically since no other highlight style is
  // registered) supply an accessible token palette: `defaultHighlightStyle`'s
  // string colour (`#a9b7c1`) is tuned for a dark editor background and
  // measures 2.05:1 against this app's light `background.codeMirrorEditor` —
  // Storybook's a11y addon (`a11y.test: 'error'`) failed the `WithJsonLinter`
  // story on exactly this (`color-contrast`, WCAG requires 4.5:1 for 14px
  // text). Two brand tokens already vetted elsewhere in this codebase for AA
  // text contrast (`text.primary`/`text.secondary`, same pair `HeadingChip`/
  // `CharacterCounter` use) replace it — flatter than a full syntax palette,
  // but every token here is a CSS-variable reference (R-T7), so it repaints
  // correctly for both colour schemes with no JS mode branch (R-T2).
  const highlightStyle = useMemo(
    () =>
      HighlightStyle.define([
        { tag: [tags.propertyName, tags.keyword, tags.atom, tags.bool, tags.null], color: theme.vars.palette.text.primary, fontWeight: 600 },
        { tag: [tags.string, tags.number], color: theme.vars.palette.text.primary },
        { tag: [tags.comment], color: theme.vars.palette.text.secondary, fontStyle: 'italic' },
        { tag: [tags.punctuation, tags.bracket, tags.separator], color: theme.vars.palette.text.secondary },
      ]),
    [theme],
  );

  const syntaxErrorListener = useMemo<Extension[]>(() => {
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
  }, [onSyntaxError]);

  const consumerExtensions = useMemo(() => extensionsProp ?? [], [extensionsProp]);

  // `aria-label` as a plain prop lands on @uiw/react-codemirror's *outer*
  // wrapper `<div>` (verified against its runtime source: every prop not in
  // its own excluded list is spread onto that div) — CM6's actual
  // `role="textbox"` element is the nested `.cm-content`, generated deeper
  // inside, and an ancestor `<div aria-label>` with no ARIA role does not
  // contribute to that element's accessible name. `EditorView.contentAttributes`
  // sets the attribute on `.cm-content` itself, which is where it is read.
  const ariaLabelExtension = useMemo<Extension[]>(
    () => (ariaLabel !== undefined ? [EditorView.contentAttributes.of({ 'aria-label': ariaLabel })] : []),
    [ariaLabel],
  );

  return (
    <CodeMirror
      value={code}
      onChange={handleChange}
      onBlur={handleBlur}
      readOnly={readOnly}
      // NOT "light": @uiw/react-codemirror's built-in `'light'` base theme
      // hardcodes `background: #fff` on the editor root — a JS-level
      // constant, invisible to the CSS-variable scheme switch, and
      // independent of whatever `theme.vars.palette.*` colours the rest of
      // this component uses. Pairing that fixed white against
      // `text.primary` (`#A9B7C1` in this brand pack's light scheme, a
      // colour clearly tuned for a DARK surface) measured 2.05:1 —
      // Storybook's a11y addon caught it (`color-contrast`, needs 4.5:1).
      // `"none"` disables CM6's own base theme entirely, so `editorTheme`
      // below (built from the same `theme.vars.palette.*` tokens for both
      // background AND text) is the only colour source — background and
      // text always come from the same scheme-aware pair, with no JS mode
      // branch (R-T2) either.
      theme="none"
      basicSetup={false}
      height={height}
      minHeight={minHeight}
      extensions={[
        editorTheme,
        history(),
        keymap.of(historyKeymap),
        search(),
        keymap.of(searchKeymap),
        lintGutter(),
        basicSetup({
          lineNumbers: true,
          foldGutter: true,
          indentOnInput: true,
          highlightActiveLineGutter: true,
          searchKeymap: false,
          history: false,
          historyKeymap: false,
          // Replaced by the accessible `highlightStyle` above — leaving this
          // on would register CM6's own low-contrast `defaultHighlightStyle`
          // alongside it (both apply; the resulting DOM carries both sets of
          // highlight classes, whichever's stylesheet wins is unspecified).
          syntaxHighlighting: false,
        }),
        syntaxHighlighting(highlightStyle),
        EditorView.lineWrapping,
        ...ariaLabelExtension,
        ...syntaxErrorListener,
        ...consumerExtensions,
        createMaxLengthExtension(maxLength),
      ]}
    />
  );
}
