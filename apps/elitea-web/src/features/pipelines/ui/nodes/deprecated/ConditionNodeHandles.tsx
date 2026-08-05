/**
 * `ConditionNode.tsx`'s three `CustomHandle`s (target, conditional-outputs
 * source, default-output source — baseline: `ConditionNode.jsx:200-233`),
 * split into their own component purely to keep `ConditionNode.tsx` under
 * the §3.5 `complexity` budget (12). No behaviour change from the
 * extraction — `isElseConnectable`/`isTargetConnectable` (baseline:
 * `ConditionNode.jsx:47-51`) are computed here from the same `flowEdges`/
 * `id` the parent already has in scope.
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { DEFAULT_OUTPUT } from '../../../lib/flow-editor/constants/flowEditor.constants';
import type { FlowEdge } from '../../../lib/flow-editor/reactFlowTypes';
import { CustomHandle } from '../CustomHandle';
import { t } from '@/shared/i18n';

export interface ConditionNodeHandlesProps {
  readonly id: string;
  readonly flowEdges: readonly FlowEdge[];
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly isPerforming: boolean;
}

const conditionalOutputHandleStyle = { left: 'calc(50% - 2.5rem)' } as const;
const defaultOutputHandleStyle = { left: 'calc(50% + 2.5rem)' } as const;

export function ConditionNodeHandles(props: ConditionNodeHandlesProps): ReactNode {
  const { id, flowEdges, isRunningPipeline, disabled, isPerforming } = props;
  const runningOrDisabled = isRunningPipeline || disabled;

  const isElseConnectable = useMemo(
    () => !flowEdges.find(edge => edge.source === id && edge.sourceHandle === DEFAULT_OUTPUT),
    [flowEdges, id],
  );
  const isTargetConnectable = useMemo(() => !flowEdges.find(edge => edge.target === id), [flowEdges, id]);

  return (
    <>
      <CustomHandle
        type="target"
        id="target"
        isConnectable={isTargetConnectable && !runningOrDisabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
      <CustomHandle
        type="source"
        id="conditional_outputs"
        style={conditionalOutputHandleStyle}
        isConnectable={!runningOrDisabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
      <CustomHandle
        type="source"
        id="default_output"
        style={defaultOutputHandleStyle}
        label={t('pipelines.flowEditor.deprecated.conditionNode.defaultOutput', 'Default output')}
        isConnectable={isElseConnectable && !runningOrDisabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
    </>
  );
}
