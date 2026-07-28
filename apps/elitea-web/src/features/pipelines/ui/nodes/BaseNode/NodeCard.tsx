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

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { FlowEditorContext, NodeCardContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import { getNodeColor } from '../../../lib/flow-editor/helpers/node.helpers';
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

  const styles = nodeCardStyles(isExpanded, isPerforming, isRunningPipeline, selected, type);

  if (!flowEditorContext) {
    return null;
  }

  return (
    <NodeCardContext.Provider value={{ isExpanded }}>
      <Box sx={styles.container}>
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
            onDuplicateName={onDuplicateName}
          />
        </Box>
        <NodeBodyContainer display={isExpanded ? 'flex' : 'none'}>
          {isEntrypoint && (
            <TriggerTypeSelector
              {...triggerProps}
              disabled={Boolean(isRunningPipeline || disabled)}
            />
          )}
          {children}
        </NodeBodyContainer>
        {handles?.(isExpanded)}
      </Box>
    </NodeCardContext.Provider>
  );
});
