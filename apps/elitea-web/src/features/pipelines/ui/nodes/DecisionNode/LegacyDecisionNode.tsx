/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/DecisionNode/LegacyDecisionNode.jsx` (288 lines) — unit A2f. Live
 * code (not deprecated-vs-current): rendered whenever a node id ends with
 * `FlowEditorConstants.DECISION_NODE_ID_SUFFIX` — see `./index.tsx`.
 *
 * See `../AgentNode.tsx`'s module doc comment for the shared account of
 * not-yet-landed sibling modules (`NodeCard`, `CustomHandle`) and
 * `llmSettings`'s "ambient -> explicit prop" redesign.
 *
 * `DecisionInputPicker` (the baseline's `Select.SingleSelect` `multiple` ->
 * locally-scoped multi-value picker redesign, a REAL confirmed capability
 * gap, not a timing issue) and all derived state/handlers now live in
 * `./LegacyDecisionNode.parts.tsx` — this component itself is pure
 * hook-call-and-render, purely to stay under the §3.5 complexity budget
 * (12); see that file's own doc comment for the full rationale.
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import type { NodeProps } from '@xyflow/react';

import { t } from '@/shared/i18n';

import { FlowEditorConstants } from '../../../lib/flow-editor/constants';
import type { AiAssistantLlmSettings } from '../../../api/aiAssistantPredict';
import type { FlowNode } from '../../../lib/flow-editor/reactFlowTypes';
import { AIAssistantInput } from '../../AIAssistantInput';
import { NodeCard } from '../BaseNode/NodeCard';
import { DecisionOutputs, commonComponentStyles } from './DecisionNodeShared';
import { DecisionInputPicker, LegacyDecisionNodeHandles, useLegacyDecisionNodeModel } from './LegacyDecisionNode.parts';

export interface LegacyDecisionNodeProps extends NodeProps<FlowNode> {
  readonly llmSettings?: AiAssistantLlmSettings | null | undefined;
}

export const LegacyDecisionNode = memo(function LegacyDecisionNode(props: LegacyDecisionNodeProps): ReactNode {
  const { id, data, selected, llmSettings } = props;
  const styles = componentStyles();
  const isPerforming = Boolean(data?.isPerforming);
  const model = useLegacyDecisionNodeModel({ id, data, llmSettings });

  return (
    <NodeCard
      name={data?.label ?? id}
      isEntrypoint={false}
      selected={selected}
      type={FlowEditorConstants.PipelineNodeTypes.Decision}
      isPerforming={isPerforming}
      id={id}
      handles={() => (
        <LegacyDecisionNodeHandles
          isRunningPipeline={model.isRunningPipeline}
          disabled={model.disabled}
          isElseConnectable={model.isElseConnectable}
          isPerforming={isPerforming}
          nodesHandleStyle={styles.nodesHandle}
          defaultOutputHandleStyle={styles.defaultOutputHandle}
        />
      )}
    >
      <DecisionInputPicker
        value={model.decisionInput}
        options={model.realInputOptions}
        onChange={model.onChangeInput}
        disabled={model.isFieldsDisabled}
      />
      <AIAssistantInput
        value={model.description}
        disabled={model.isFieldsDisabled}
        label={t('pipelines.flowEditor.decisionNode.description', 'Description')}
        fieldName="description"
        modelConfig={model.resolvedLlmSettings}
        fieldBinding={{ name: 'description', id: 'description', onInput: model.onChangeDecisionDescription }}
      />
      <DecisionOutputs
        id={id}
        decisionOutput={model.decisionOutput}
        onRemoveOutput={model.onRemoveOutput}
        isRunningPipeline={model.isRunningPipeline}
        disabled={model.disabled}
      />
    </NodeCard>
  );
});

interface LegacyDecisionNodeStyles {
  readonly inputEnhancerContainer: ReturnType<typeof commonComponentStyles>['inputEnhancerContainer'];
  /** `CustomHandle`'s `style` prop is plain `CSSProperties`, not `SxProps` — a static left-offset, not theme-dependent. */
  readonly nodesHandle: { readonly left: string };
  readonly defaultOutputHandle: { readonly left: string };
}

function componentStyles(): LegacyDecisionNodeStyles {
  return {
    ...commonComponentStyles(),
    nodesHandle: { left: 'calc(50% - 3.125rem)' },
    defaultOutputHandle: { left: 'calc(50% + 3.125rem)' },
  };
}
