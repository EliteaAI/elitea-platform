/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/DecisionNode/index.jsx` (21 lines) — unit A2f. Runtime-switches
 * between `LegacyDecisionNode`/`NormalDecisionNode` by node-id suffix; both
 * variants are live (see each file's own doc comment), not a legacy-vs-
 * current deprecation split.
 */
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';

import type { NodeProps } from '@xyflow/react';

import { FlowEditorConstants } from '../../../lib/flow-editor/constants';
import type { FlowNode } from '../../../lib/flow-editor/reactFlowTypes';
import { LegacyDecisionNode, type LegacyDecisionNodeProps } from './LegacyDecisionNode';
import { NormalDecisionNode, type NormalDecisionNodeProps } from './NormalDecisionNode';

export type DecisionNodeProps = NodeProps<FlowNode> & Pick<LegacyDecisionNodeProps & NormalDecisionNodeProps, 'llmSettings'>;

export const DecisionNode = memo(function DecisionNode(props: DecisionNodeProps): ReactNode {
  const { id, data, selected, llmSettings } = props;
  const isLegacyDecisionNode = useMemo(() => id.endsWith(FlowEditorConstants.DECISION_NODE_ID_SUFFIX), [id]);

  if (isLegacyDecisionNode) {
    return (
      <LegacyDecisionNode
        {...props}
        id={id}
        data={data}
        selected={selected}
        llmSettings={llmSettings}
      />
    );
  }

  return (
    <NormalDecisionNode
      {...props}
      id={id}
      data={data}
      selected={selected}
      llmSettings={llmSettings}
    />
  );
});
