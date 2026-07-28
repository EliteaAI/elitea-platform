import type { ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';

import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { createYamlLinter, YAML_ERROR_MARK_CLASS } from '../lib/yamlLint';

/** @public features/pipelines UI — the pipeline flow editor's raw-YAML tab. */
export interface YamlCodeEditorProps {
  /** The YAML document text. */
  code: string;
  /** Fires ~30ms after the last keystroke (via `CodeMirrorEditor`'s own debounce). */
  onChangeCode: (code: string) => void;
  disabled?: boolean;
}

/**
 * The pipeline flow editor's YAML tab: a `CodeMirrorEditor` with a YAML
 * validity linter. Ported from `apps/elitea-ui/src/[fsd]/features/
 * pipelines/yaml-editor/ui/YamlCodeEditor.jsx` (baseline, 69 lines).
 *
 * DEPENDENCY-INJECTION DEVIATION (deliberate, documented): the baseline read
 * `useSelector(state => state.pipeline)` directly to imperatively reset the
 * editor's content (`editorRef.current?.setCode(yamlCode)`) whenever a
 * Redux `resetFlag` flipped, via `Field.CodeMirrorEditor`'s
 * `forwardRef`/`useImperativeHandle` API. Neither exists in this app: there
 * is no global Redux store (this app's replacement for the baseline's
 * `slices/pipeline.js`/`pipelineEditor.js` client-editing-state is a
 * Wave-2 `processes/pipeline-editor` slice — see
 * `entities/pipeline/model/types.ts`'s own doc comment — not built by this
 * sub-unit), and this app's `CodeMirrorEditor` (unit S1-E) deliberately
 * exposes no imperative ref API (`CodeMirrorEditor.tsx`'s own doc comment:
 * "No imperative ref API ... neither in-scope caller ever attaches a ref").
 * A reset is achieved declaratively instead: `CodeMirrorEditor` already
 * re-syncs its internal document whenever its `value` prop changes to
 * something other than what it last echoed back via `onChange` (see its own
 * `useEffect` on `value`) — so a caller that wants to reset this editor's
 * content simply passes a new `code` value (e.g. from whatever process-level
 * store owns the reset), the same "prop drives content" contract every
 * other controlled `CodeMirrorEditor` consumer in this app already follows.
 * No separate reset channel is needed on this component.
 *
 * Styling deviation forced by the same S1-E prop-surface trim:
 * `CodeMirrorEditor` accepts no `className`/`sx` passthrough (confirmed by
 * reading its prop list), so the baseline's
 * `styled(Field.CodeMirrorEditor)({'& .error_yaml_code': {...}})` wrapper
 * (which relied on `className` reaching the editor root) cannot be ported
 * as-is. The `.error_yaml_code` CSS class itself is still produced by CM6
 * (via `createYamlLinter`'s `markClass`) directly on the diagnostic's marked
 * DOM span, regardless of which component rendered it — so the same nested
 * `& .error_yaml_code` rule is applied one level up, on this component's own
 * wrapping `Box` (an ancestor of that span either way), producing the exact
 * same visual highlight. `className="nopan nodrag nowheel"` (baseline: React
 * Flow's "exclude this element from pan/zoom/wheel gestures" convention,
 * checked by React Flow via `closest()` against the event target's
 * ancestors) moves to this same wrapping `Box` for the identical reason.
 */
export function YamlCodeEditor({ code, onChangeCode, disabled = false }: YamlCodeEditorProps): ReactNode {
  const extensions = useMemo(() => [createYamlLinter()], []);

  return (
    <Box
      className="nopan nodrag nowheel"
      data-testid="pipeline-yaml-editor"
      sx={(theme) => ({
        width: '100%',
        maxWidth: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        // R-T1: colours come from brand tokens, never raw literals. The
        // baseline hardcoded `rgba(215, 22, 22, 0.20)`; `background.errorBkg`
        // (`default.pack.json`) is the same red (215, 22, 22) already used
        // brand-wide for error surfaces, at that token's own 0.08 alpha
        // (vs. baseline's ad-hoc 0.20) — close enough visually as a subtle
        // in-editor highlight, and, unlike the baseline value, it is a live
        // CSS-variable reference that repaints correctly for both colour
        // schemes (R-T7) instead of one fixed literal for both.
        [`& .${YAML_ERROR_MARK_CLASS}`]: {
          backgroundColor: theme.vars.palette.background.errorBkg,
          background: theme.vars.palette.background.errorBkg,
        },
      })}
    >
      <CodeMirrorEditor
        value={code}
        onChange={onChangeCode}
        extensions={extensions}
        height="100%"
        minHeight="400px"
        readOnly={disabled}
      />
    </Box>
  );
}
