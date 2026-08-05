/**
 * The plain target/source `CustomHandle` pair shared, verbatim, by
 * `ToolNode.jsx`/`LoopNode.jsx`/`LoopToolNode.jsx` (baseline: e.g.
 * `ToolNode.jsx:163-183`) — every deprecated node in this sub-unit except
 * `ConditionNode` (three handles, its own `ConditionNodeHandles.tsx`).
 * Split out purely to keep each node component under the §3.5
 * `complexity` budget. No behaviour change from the extraction.
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { PipelineNodeTypes } from '../../../lib/flow-editor/constants/flowEditor.constants';
import type { FlowEdge } from '../../../lib/flow-editor/reactFlowTypes';
import { CustomHandle } from '../CustomHandle';

export interface SimpleNodeHandlesProps {
  readonly id: string;
  readonly edges: readonly FlowEdge[];
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly isPerforming: boolean;
}

export function SimpleNodeHandles(props: SimpleNodeHandlesProps): ReactNode {
  const { id, edges, isRunningPipeline, disabled, isPerforming } = props;
  const runningOrDisabled = isRunningPipeline || disabled;

  const isSourceConnectable = useMemo(
    () => !edges.find(edge => edge.source === id && edge.target !== PipelineNodeTypes.End),
    [edges, id],
  );

  return (
    <>
      <CustomHandle
        type="target"
        id="target"
        isConnectable={!runningOrDisabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
      <CustomHandle
        type="source"
        id="source"
        isConnectable={isSourceConnectable && !runningOrDisabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
    </>
  );
}
