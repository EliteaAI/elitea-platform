/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/BaseNode/NodeCard.jsx` (83 lines, unit A2e).
 *
 * DISCLOSED DEVIATIONS, each forced by a real, verified constraint:
 *
 *  - `FlowEditorContext`/`NodeCardContext` come from `../../../lib/flow-
 *    editor/flowEditorContext` (unit A2d) instead of the baseline's
 *    `app/providers` import -- see that file's own header for the R-L1
 *    rationale.
 *  - `theme`-callback `sx` values read `theme.vars.palette.*` (R-T7), not
 *    `theme.palette.*`.
 *  - `toolNames`/`onDuplicateName` are new optional props, forwarded
 *    straight through to `NodeCardHeader` -- that component's own
 *    "ambient context -> parameter" deviations (Formik tools read /
 *    `toastError`, see its own header) need something to supply them, and
 *    `NodeCard` is the only baseline layer between `NodeCardHeader` and its
 *    eventual pipeline-editor-form caller.
 *
 * FIX (confirmed adversarial-review finding #2, this file:50): grepped
 * across the whole `src` tree, no node component anywhere in the pipelines
 * feature ever actually supplies `toolNames`/`onDuplicateName` to `NodeCard`
 * -- both silently default (`toolNames` to `[]` inside `NodeCardHeader`,
 * `onDuplicateName` to `undefined`). Two different-severity problems, only
 * the second fixable inside this file's own scope:
 *  - `toolNames` genuinely cannot be populated here: it needs the whole
 *    pipeline's `version_details.tools` list, which only the not-yet-built
 *    react-hook-form-backed pipeline-editor form (see this file's own
 *    deviation note above) has -- `FlowEditorContextValue` (`../../../lib/
 *    flow-editor/flowEditorContext.ts`, transcribed verbatim from the
 *    baseline provider, not invented) carries no such field, and every
 *    `<NodeCard>` call site (`AgentNode.tsx`, `RouterNode.tsx`,
 *    `StateModifierNode.tsx`, `PrinterNode.tsx`, `CodeNode.tsx`,
 *    `BaseToolNode.tsx`, `HITLNode.tsx`, `DefaultNode.tsx`, ...) is a node
 *    component scoped to its OWN node, with no pipeline-wide toolkit-name
 *    list to hand down either. Genuinely out of this cluster's scope --
 *    routed to whichever sub-unit builds that form.
 *  - `onDuplicateName` being `undefined` made the existing node-id-collision
 *    revert (`NodeCardHeader.tsx`'s `onBlur`, still correctly detected
 *    internally) silent: no toast, no message, the user's rename just
 *    reverted with no explanation -- a real behaviour loss versus the
 *    baseline's `toastError`. THIS is fixable inside `NodeCard` alone: when
 *    no caller supplies `onDuplicateName`, `NodeCard` now falls back to its
 *    own `handleInternalDuplicateName`, surfaced as a local `Snackbar`+
 *    `Alert` (severity="error", auto-hiding) -- the same "no app-wide
 *    `useToast()` exists yet, render `Snackbar`+`Alert` locally instead"
 *    pattern already established by `features/settings/ui/system-prompts/
 *    ServicePromptsBody.tsx` and `pages/settings/Secrets.tsx` (grepped:
 *    both real, landed files, not invented precedent). A caller that DOES
 *    supply its own `onDuplicateName` is unaffected -- the local fallback
 *    only engages when the prop is absent, so this never double-surfaces
 *    the message once a real app-wide toast system and a real
 *    `toolNames`-supplying caller both land.
 *  - `triggerProps` (everything the real, landed `TriggerTypeSelector`
 *    (unit A2h) needs beyond `disabled`: `projectId`/`versionId`/
 *    `versionInstructions`/`onNotifySuccess`/`onNotifyError`, all of that
 *    component's own "ambient -> explicit prop" deviations, see its own
 *    doc comment) is a new optional prop for the same reason as
 *    `toolNames`/`onDuplicateName` above -- `NodeCard` has no version/
 *    project data of its own to supply them from.
 */
import type { ReactNode } from 'react';
import { memo, useCallback, useContext, useEffect, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import type { SxProps, Theme } from '@mui/material/styles';

import { FlowEditorContext, NodeCardContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import { getNodeColor } from '../../../lib/flow-editor/helpers/node.helpers';
import { NodeAdmissionIssues } from '../../settings/NodeAdmissionIssues';
import { TriggerTypeSelector, type TriggerTypeSelectorProps } from '../../settings/TriggerTypeSelector';
import { NodeBodyContainer } from './NodeBodyContainer';
import { NodeCardHeader } from './NodeCardHeader';

export interface NodeCardProps {
  readonly name: string;
  readonly isEntrypoint: boolean;
  readonly children?: ReactNode;
  readonly selected?: boolean;
  readonly isConditionNode?: boolean;
  readonly handles?: (isExpanded: boolean) => ReactNode;
  readonly isPerforming?: boolean;
  readonly type: string;
  readonly id: string;
  /** Forwarded to `NodeCardHeader` -- see that component's own "DISCLOSED REDESIGNS" header, deviation 1. */
  readonly toolNames?: readonly string[];
  /** Forwarded to `NodeCardHeader` -- see that component's own "DISCLOSED REDESIGNS" header, deviation 2. */
  readonly onDuplicateName?: (message: string) => void;
  /** Forwarded to `TriggerTypeSelector` (rendered only when `isEntrypoint`) alongside this component's own computed `disabled` -- see module doc comment. */
  readonly triggerProps?: Omit<TriggerTypeSelectorProps, 'disabled'>;
}

/**
 * Auto-hide duration for the `onDuplicateName`-not-supplied fallback
 * `Snackbar` (see this file's module doc comment, "FIX" paragraph) --
 * matches `ServicePromptsBody.tsx`'s own local `Snackbar` precedent
 * (`autoHideDuration={5000}`).
 */
const DUPLICATE_NAME_FALLBACK_AUTO_HIDE_MS = 5000;

interface NodeCardStyles {
  readonly container: SxProps<Theme>;
  readonly header: SxProps<Theme>;
}

function nodeCardStyles(
  isExpanded: boolean,
  isPerforming: boolean | undefined,
  isRunningPipeline: boolean | undefined,
  selected: boolean | undefined,
  type: string,
): NodeCardStyles {
  return {
    container: (theme: Theme) => ({
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      width: '29.4375rem',
      height: 'auto',
      borderRadius: theme.vars.shape.radiusMd,
      position: 'relative',
      border: `${isPerforming ? '.125rem dashed' : '.0625rem solid'} ${
        isPerforming || (!isRunningPipeline && selected)
          ? theme.vars.palette.primary.main
          : theme.vars.palette.border.flowNode
      }`,
      background: theme.vars.palette.background.tabPanel,
    }),
    header: (theme: Theme) => ({
      height: '2.75rem',
      display: 'flex',
      padding: `${theme.spacing(0.5)} ${theme.spacing(2)}`,
      width: '100%',
      boxSizing: 'border-box',
      alignItems: 'center',
      overflow: 'hidden',
      borderBottom: isExpanded ? `.0625rem solid ${theme.vars.palette.border.flowNode}` : 'none',
      backgroundColor: getNodeColor(type, theme),
      borderRadius: isExpanded
        ? `${theme.vars.shape.radiusMd} ${theme.vars.shape.radiusMd} 0 0`
        : theme.vars.shape.radiusMd,
    }),
  };
}

interface NodeCardHeaderSlotProps {
  readonly name: string;
  readonly isEntrypoint: boolean;
  readonly isExpanded: boolean;
  readonly onExpand: (newState: boolean) => void;
  readonly isConditionNode: boolean | undefined;
  readonly type: string;
  readonly id: string;
  readonly flowEditorContext: FlowEditorContextValue;
  readonly isRunningPipeline: boolean | undefined;
  readonly toolNames: readonly string[] | undefined;
  readonly onDuplicateName: ((message: string) => void) | undefined;
}

/**
 * `NodeCard.jsx:30-39` (the `NodeCardHeader` call) as its own named
 * component -- split out purely to keep `NodeCard` under the §3.5
 * complexity ceiling (each conditional-spread, needed for
 * `exactOptionalPropertyTypes`, counts as a branch).
 */
function NodeCardHeaderSlot({
  name,
  isEntrypoint,
  isExpanded,
  onExpand,
  isConditionNode,
  type,
  id,
  flowEditorContext,
  isRunningPipeline,
  toolNames,
  onDuplicateName,
}: NodeCardHeaderSlotProps): ReactNode {
  return (
    <NodeCardHeader
      name={name}
      isEntrypoint={isEntrypoint}
      isExpanded={isExpanded}
      onExpand={onExpand}
      {...(isConditionNode !== undefined ? { isConditionNode } : {})}
      type={type}
      id={id}
      {...(flowEditorContext.disabled !== undefined ? { disabled: flowEditorContext.disabled } : {})}
      yamlJsonObject={flowEditorContext.yamlJsonObject}
      setYamlJsonObject={flowEditorContext.setYamlJsonObject}
      setFlowNodes={flowEditorContext.setFlowNodes}
      setFlowEdges={flowEditorContext.setFlowEdges}
      {...(isRunningPipeline !== undefined ? { isRunningPipeline } : {})}
      {...(flowEditorContext.handleDeleteNode ? { handleDeleteNode: flowEditorContext.handleDeleteNode } : {})}
      {...(toolNames !== undefined ? { toolNames } : {})}
      {...(onDuplicateName !== undefined ? { onDuplicateName } : {})}
    />
  );
}

export const NodeCard = memo(function NodeCard(props: NodeCardProps): ReactNode {
  const {
    name,
    isEntrypoint,
    children,
    selected,
    isConditionNode,
    handles,
    isPerforming,
    type,
    id,
    toolNames,
    onDuplicateName,
    triggerProps,
  } = props;
  const [isExpanded, setIsExpanded] = useState(true);
  const [fallbackDuplicateMessage, setFallbackDuplicateMessage] = useState<string | null>(null);
  const flowEditorContext = useContext(FlowEditorContext);
  const isRunningPipeline = flowEditorContext?.isRunningPipeline;
  const expandAll = flowEditorContext?.expandAll;
  const disabled = flowEditorContext?.disabled;

  const onExpand = useCallback((newState: boolean) => {
    setIsExpanded(newState);
  }, []);

  useEffect(() => {
    setIsExpanded(Boolean(expandAll));
  }, [expandAll]);

  /**
   * Engages only when the caller supplies no `onDuplicateName` of its own
   * (see module doc comment, "FIX" paragraph) -- surfaces the exact same
   * duplicate-name message `NodeCardHeader.tsx`'s `onBlur` already builds,
   * instead of the silent revert this cluster's adversarial review found.
   */
  const handleInternalDuplicateName = useCallback((message: string) => {
    setFallbackDuplicateMessage(message);
  }, []);

  const handleFallbackAlertClose = useCallback(() => {
    setFallbackDuplicateMessage(null);
  }, []);

  const effectiveOnDuplicateName = onDuplicateName ?? handleInternalDuplicateName;

  const styles = nodeCardStyles(isExpanded, isPerforming, isRunningPipeline, selected, type);

  if (!flowEditorContext) {
    return null;
  }

  return (
    <NodeCardContext.Provider value={{ isExpanded }}>
      {/*
        `data-performing` exposes `isPerforming` — the "this node is running
        RIGHT NOW" highlight `useRunEvent` sets from the streamed run events
        — as something other than a border style. It carries no appearance of
        its own; `styles.container` still owns the dashed border. Without it
        the only evidence that a run reached the canvas is a computed
        `border-style`, which is not an assertion a journey can make about
        the mechanism (`e2e/streaming/chat.pipeline-authored.spec.ts` reads
        this attribute to prove the run feed is live during a turn).
      */}
      <Box
        sx={styles.container}
        data-performing={isPerforming ? 'true' : 'false'}
      >
        <Box sx={styles.header}>
          <NodeCardHeaderSlot
            name={name}
            isEntrypoint={isEntrypoint}
            isExpanded={isExpanded}
            onExpand={onExpand}
            isConditionNode={isConditionNode}
            type={type}
            id={id}
            flowEditorContext={flowEditorContext}
            isRunningPipeline={isRunningPipeline}
            toolNames={toolNames}
            onDuplicateName={effectiveOnDuplicateName}
          />
        </Box>
        <NodeBodyContainer display={isExpanded ? 'flex' : 'none'}>
          {isEntrypoint && (
            <TriggerTypeSelector
              {...triggerProps}
              disabled={Boolean(isRunningPipeline || disabled)}
            />
          )}
          {/*
            Every reason the native pipeline runtime would refuse THIS node,
            named by field and value. Mounted here rather than in each node
            component because this is the one card body they all share —
            five families (Router, HITL, Printer, StateModifier, the legacy
            Decision) render no `CommonInterruptSettings`, so hanging it
            there would have left them silent.
          */}
          <NodeAdmissionIssues nodeId={id} />
          {children}
        </NodeBodyContainer>
        {handles?.(isExpanded)}
      </Box>
      {!onDuplicateName && (
        <Snackbar
          open={Boolean(fallbackDuplicateMessage)}
          autoHideDuration={DUPLICATE_NAME_FALLBACK_AUTO_HIDE_MS}
          onClose={handleFallbackAlertClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={handleFallbackAlertClose}
            severity="error"
            variant="filled"
          >
            {fallbackDuplicateMessage}
          </Alert>
        </Snackbar>
      )}
    </NodeCardContext.Provider>
  );
});
