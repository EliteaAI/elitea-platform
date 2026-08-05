import type { ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { handleCopy } from '@/shared/lib/clipboard';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { ExpandedViewerModal } from '@/shared/ui/ExpandedViewerModal';
import { CollapseIcon } from '@/shared/ui/icons/collapse-icon';
import { ExpandIcon } from '@/shared/ui/icons/expand-icon';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';

const MIN_HEIGHT = '18.75rem';
const MAX_HEIGHT = '37.5rem';

/**
 * `linter(jsonParseLinter())` — baseline `CodeMirrorLinterHelpers.jsonLinter`
 * (`apps/elitea-ui/src/[fsd]/shared/lib/helpers/codeMirrorLinter.helpers.js`,
 * exported single-purpose constant among ~15 other per-language linters this
 * unit does not need). Reproduced locally rather than porting that whole
 * 260-line multi-language helper file — nothing else in this sub-unit's
 * owned files needs any of its other exports (`getExtensionsByLang`,
 * `languageOptions`, the YAML/Jinja/Mermaid/Markdown linters), and that file
 * is not in this unit's owned-file list.
 */
const jsonLinter = linter(jsonParseLinter());
const jsonExtensions = [json(), jsonLinter];

/**
 * `CodeMirrorEditorHelpers.languageOptions` (baseline: ~40-language catalogue
 * feeding the fullscreen dialog's disabled "Content type" dropdown — the
 * dropdown was ALWAYS locked to `value="json"` in this file, `disabled`
 * unconditionally; baseline `CustomNodeInput.jsx:250-257`). Reproduced as
 * the one option this component ever actually shows, rather than porting
 * that 40-entry catalogue for a selector that can never select anything
 * else here.
 */
const LANGUAGE_OPTIONS = [{ label: 'JSON', value: 'json' }];

/** @public features/pipelines UI — a raw-JSON editor for a flow-editor node's full YAML `data`, minus its `id`. */
export interface CustomNodeInputProps {
  readonly id: string;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/CustomNodeInput.jsx` (baseline, 320 lines) — unit A2i.
 *
 * DEVIATIONS FROM BASELINE, all forced by real, verified constraints:
 *  - Baseline's two `Field.CodeMirrorEditor` instances (inline + full-screen)
 *    sync via `forwardRef`/`useImperativeHandle` (`editorRef.current?.
 *    setCode(...)`, `fullScreenEditorRef.current?.setCode(...)`). This app's
 *    ported `shared/ui/CodeMirrorEditor` (unit S1-E) deliberately exposes no
 *    imperative ref API — its own doc comment: "No imperative ref API ...
 *    neither in-scope caller ever attaches a ref" — and instead re-syncs its
 *    internal document declaratively whenever its `value` prop changes.
 *    Both instances below are simply bound to the SAME `jsonString` state
 *    (`value`/`onChange`/`onBlur`), which keeps them in sync with no
 *    imperative call needed — the identical fix `YamlCodeEditor.tsx` (a
 *    sibling A2 unit) already applied for the same reason; see that file's
 *    own doc comment for the full rationale.
 *  - Baseline's hand-rolled full-screen `Dialog` (copy button, disabled
 *    "Content type" selector, close/escape handling) is replaced with this
 *    app's already-ported `shared/ui/ExpandedViewerModal` (unit S1-H),
 *    which already composes exactly this: a fullscreen `BaseModal`, a
 *    caller-controlled `language` selector, and a `header.onCopy` button.
 *    `AIAssistantModal.tsx` (a sibling `pipelines` unit) established this
 *    exact "use `ExpandedViewerModal` instead of a hand-rolled Dialog"
 *    precedent for the same shape of baseline component.
 *  - `useToast()` (`toastInfo`/`toastError` on copy success/failure) has no
 *    ported equivalent anywhere in this app yet (grepped: no `useToast`
 *    export exists in `shared/` or `features/pipelines/`) — the same real
 *    gap `AIAssistantModal.tsx`'s own doc comment records ("`useToast()`
 *    calls are replaced with ..."). Dropped here with no replacement
 *    surface (unlike that file, this component has no natural inline error
 *    slot for a transient "copied" confirmation); the actual clipboard
 *    write still happens via `shared/lib/clipboard`'s `handleCopy` (the
 *    same helper this app's `CopyToClipboardButton`/`InputActionsToolbar`
 *    use), so copying itself is unaffected — only the toast notification is
 *    missing.
 *  - `StyledTooltip` (baseline: `@/ComponentsLib/Tooltip`) -> MUI's
 *    `Tooltip` directly, matching every other sibling unit's identical
 *    mapping (`AIAssistantModalSplitView.tsx`, `DecisionNodeShared.tsx`).
 *  - `CopyIcon`/`CloseIcon` (baseline: hand-rolled `@/components/Icons/*`,
 *    no ported `shared/ui/icons` equivalent) -> `@mui/icons-material`'s
 *    `ContentCopy`/`Close` (R-I1, this codebase's established fallback —
 *    `AIPromptInput.tsx`'s own doc comment records the identical
 *    substitution for the identical reason). `CollapseIcon`/`ExpandIcon`
 *    (baseline: `@/assets/{collapse,expand}-icon.svg?react`) map onto this
 *    app's already-ported, byte-identical-source `shared/ui/icons/
 *    {collapse,expand}-icon.tsx` (unit S2) — a real, exact port, not a
 *    fallback.
 *  - Every `IconButton` gets an explicit `aria-label` (baseline had none,
 *    relying on the `Tooltip` alone) — the same a11y fix this app's own
 *    `InputActionsToolbar`/`ExpandedViewerModal.CopyButton` already apply,
 *    for the identical reason (a tooltip is not an accessible name).
 */
export function CustomNodeInput({ id }: CustomNodeInputProps): ReactNode {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;
  const setYamlJsonObject = context?.setYamlJsonObject;

  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find((node) => node.id === id), [id, yamlJsonObject?.nodes]);

  const originalJsonString = useMemo(() => {
    if (!yamlNode) return '{}';
    const { id: _nodeId, ...otherProps } = yamlNode;
    return JSON.stringify(otherProps, null, 2);
  }, [yamlNode]);

  const [jsonString, setJsonString] = useState(originalJsonString);
  const [error, setError] = useState('');
  const [fullScreenMode, setFullScreenMode] = useState(false);
  const [minHeight, setMinHeight] = useState(MIN_HEIGHT);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    setJsonString(originalJsonString);
  }, [originalJsonString]);

  const handleChange = useCallback((value: string) => {
    setJsonString(value);
  }, []);

  const handleBlur = useCallback(
    (value: string) => {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const obj: Record<string, unknown> = { id, ...parsed };
        if (obj['type'] === undefined) {
          setError('JSON must have name, description, and settings fields');
        } else {
          setError('');
          if (setYamlJsonObject) {
            FlowEditorHelpers.batchUpdateYamlNode(id, obj, yamlJsonObject, setYamlJsonObject, true);
          }
        }
      } catch {
        setError('Invalid node format');
      }
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const onFullScreen = useCallback(() => setFullScreenMode(true), []);
  const onExitFullScreen = useCallback(() => setFullScreenMode(false), []);
  const onCopy = useCallback(() => {
    void handleCopy(jsonString);
  }, [jsonString]);
  const onSwitchHeight = useCallback(() => {
    setMinHeight((prev) => (prev === MIN_HEIGHT ? MAX_HEIGHT : MIN_HEIGHT));
  }, []);

  const readOnly = Boolean(context?.isRunningPipeline) || Boolean(context?.disabled);
  const isExpanded = minHeight === MAX_HEIGHT;
  const copyLabel = t('pipelines.customNodeInput.copy', 'Copy to clipboard');
  const fullScreenLabel = t('pipelines.customNodeInput.fullScreen', 'Full screen view');
  const expandLabel = isExpanded
    ? t('pipelines.customNodeInput.collapse', 'Collapse editor')
    : t('pipelines.customNodeInput.expand', 'Expand editor');

  return (
    <>
      <Box
        className="nowheel"
        sx={containerSx}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {error && <Box sx={errorSx}>{error}</Box>}
        {isHovering && (
          <Box sx={toolbarSx}>
            <Tooltip
              title={copyLabel}
              placement="top"
            >
              <IconButton
                color="tertiary"
                aria-label={copyLabel}
                disabled={!jsonString}
                onClick={onCopy}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={fullScreenLabel}
              placement="top"
            >
              <IconButton
                color="tertiary"
                aria-label={fullScreenLabel}
                onClick={onFullScreen}
              >
                <FullscreenOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={expandLabel}
              placement="top"
            >
              <IconButton
                color="tertiary"
                aria-label={expandLabel}
                onClick={onSwitchHeight}
              >
                <SvgIcon
                  component={isExpanded ? CollapseIcon : ExpandIcon}
                  inheritViewBox
                  fontSize="small"
                />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <CodeMirrorEditor
          value={jsonString}
          onChange={handleChange}
          onBlur={handleBlur}
          extensions={jsonExtensions}
          readOnly={readOnly}
          height={minHeight}
          minHeight={minHeight}
        />
      </Box>
      <ExpandedViewerModal
        open={fullScreenMode}
        onClose={onExitFullScreen}
        title={fullScreenLabel}
        language={{ value: 'json', options: LANGUAGE_OPTIONS, disabled: true }}
        header={{ onCopy }}
        content={
          <Box sx={fullScreenContentSx}>
            {error && <Box sx={errorSx}>{error}</Box>}
            <CodeMirrorEditor
              value={jsonString}
              onChange={handleChange}
              onBlur={handleBlur}
              extensions={jsonExtensions}
              readOnly={readOnly}
              height="100%"
              minHeight="100%"
            />
          </Box>
        }
      />
    </>
  );
}

const containerSx: SxProps<Theme> = {
  position: 'relative',
};

const errorSx: SxProps<Theme> = (theme: Theme) => ({
  color: theme.vars.palette.text.error,
});

const toolbarSx: SxProps<Theme> = {
  position: 'absolute',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.25rem',
  top: '0.3125rem',
  right: '0.75rem',
  zIndex: 999,
};

const fullScreenContentSx: SxProps<Theme> = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};
