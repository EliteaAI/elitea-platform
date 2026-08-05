/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/deprecated/ConditionNode.jsx` (~280 lines) — unit A2g. NOT dead
 * code: still actively registered by the not-yet-built `FlowEditor.jsx`
 * canvas sub-unit (A2k) for pipelines whose stored YAML still uses the
 * legacy inline-condition node type — see this unit's mission NOTES.
 *
 * DISCLOSED REDESIGNS, each forced by a real, verified constraint:
 *
 *  1. `useNodeAiAssistantConfig()` (baseline, no args, ambient
 *     `useFormikContext().values.version_details.llm_settings` read) — the
 *     already-landed `lib/flow-editor/hooks/useNodeAiAssistantConfig.ts`
 *     (unit A2d) redesigned this to a plain `llmSettings` parameter (its
 *     own doc comment: this app has no Formik, react-hook-form + zod
 *     instead). This component takes `llmSettings` as a prop for the same
 *     reason, and forwards it through unchanged.
 *  2. The "Conditional input" field's `Select.SingleSelect` (`multiple`)
 *     has no shared/ui equivalent — reuses the already-landed sibling
 *     `ui/select/PipelineMultiSelect.tsx` (unit A2h), built for the SAME
 *     gap (that file's own doc comment: "this app's already-landed
 *     `shared/ui/SingleSelect`... is single-value ONLY"). Intra-slice
 *     import, R-L3-legal — reused rather than re-built to avoid a second,
 *     near-identical local multi-select in the same slice.
 *  3. `Input.InputBase`'s baseline usage was via `AIAssistantInput`
 *     spreading `{...leftProps}` onto it, including `onInput`. This app's
 *     ported `AIAssistantInput` (unit A2a, `../../AIAssistantInput.tsx`)
 *     does NOT forward an `onChange`/`onInput` prop at all (verified by
 *     reading its full, current source: `AIAssistantInputProps` has no
 *     such field, and none of its destructured props are spread onward) —
 *     its inline preview field is therefore presentation-only; editing the
 *     condition definition happens through the AI Assistant modal itself,
 *     wired via the `fieldBinding.onInput` callback the modal already
 *     supports (`AIAssistantModal.tsx`'s `dispatchFieldChange`). This is a
 *     real, already-landed A2a interface, not something this sub-unit can
 *     fix (out of its owned files) — `onChangeConditionDefinition` below is
 *     wired through `fieldBinding` instead of a direct `onInput` prop, the
 *     only edit path this landed component actually exposes.
 *  4. `StyledTooltip`/`StyledChip`/`RemoveIcon` (baseline: `@/ComponentsLib/
 *     Tooltip`, `@/components/DataDisplay/StyledChip`,
 *     `@/assets/remove-icon.svg?react`) -> MUI `Tooltip`/`Chip` +
 *     `shared/ui/icons/remove-icon`, matching the already-landed sibling
 *     `ui/nodes/DecisionNode/DecisionNodeShared.tsx`'s (unit A2f) own
 *     identical substitution for the SAME `getBorderColorAndTooltip`-driven
 *     chip list, including its `& .MuiChip-deleteIcon` selector ->
 *     colour-wrapped-icon fix (R-T6, `no-mui-internal-selector`).
 *  5. **Bug-for-bug divergence, fixed to match its own correct sibling:**
 *     the baseline's OWN `outputChip` style factory
 *     (`ConditionNode.jsx:305-317`) interpolates `getBorderColorAndTooltip`'s
 *     return value (`'rejected' | 'published' | 'onModeration'`, a
 *     semantic key) directly into a CSS `border` string —
 *     `` `0.0625rem solid ${borderColor} !important` `` — never resolving
 *     it through `palette.status[...]` the way the near-identical
 *     `DecisionNodeShared.jsx`'s `styledChip` (baseline, same helper, same
 *     purpose) does one file over. That is not a real colour value, so the
 *     baseline's own border is effectively unstyled here — an observed
 *     baseline defect, not an intentional style. This port resolves it via
 *     `theme.vars.palette.status[borderColor]`, matching the already-landed
 *     `DecisionNodeShared.tsx`'s own correct handling of the identical
 *     helper output, rather than silently reproducing the bug.
 *  6. `theme.palette.*` -> `theme.vars.palette.*` (R-T7, matching every
 *     other already-landed sibling in this tree).
 *
 * `NodeCard` (unit A2e) and `CustomHandle` (unit A2e) have both landed and
 * are imported for real, verified against their actual current props.
 * `NodeCard` reads `FlowEditorContext` internally (for `NodeCardHeader`'s
 * `yamlJsonObject`/`setYamlJsonObject`/`setFlowNodes`/`setFlowEdges` and
 * `TriggerTypeSelector`'s `disabled`) — no extra wiring is needed here.
 */
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useEdges, useNodes } from '@xyflow/react';

import type { AiAssistantLlmSettings } from '../../../api/aiAssistantPredict';
import { CONDITION_NODE_ID_SUFFIX, PipelineNodeTypes } from '../../../lib/flow-editor/constants/flowEditor.constants';
import type { FlowGraphEdge, YamlConditionSpec, YamlPipelineNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { useInputOptions } from '../../../lib/flow-editor/hooks/useInputOptions';
import { useNodeAiAssistantConfig } from '../../../lib/flow-editor/hooks/useNodeAiAssistantConfig';
import type { FlowEdge, FlowNode, FlowNodeData } from '../../../lib/flow-editor/reactFlowTypes';
import { AIAssistantInput } from '../../AIAssistantInput';
import { PipelineMultiSelect } from '../../select/PipelineMultiSelect';
import { NodeCard } from '../BaseNode/NodeCard';
import { t } from '@/shared/i18n';
import { ConditionNodeHandles } from './ConditionNodeHandles';
import { ConditionOutputsList } from './ConditionOutputsList';
import { useConditionNodeEditing } from './useConditionNodeEditing';
import { useFlowEditorNodeContext } from './useFlowEditorNodeContext';

export interface ConditionNodeProps {
  readonly id: string;
  readonly data?: FlowNodeData | undefined;
  readonly selected?: boolean | undefined;
  /** See module doc comment, deviation 1. */
  readonly llmSettings?: AiAssistantLlmSettings | null | undefined;
}

/** `ConditionNode.jsx:38` — `yamlNode.condition` (persisted) wins over `data.condition` (the freshly-created node's in-memory default), matching baseline precedence. A plain top-level function (not inlined in the component body) purely to keep `ConditionNode`'s own `complexity` count under the §3.5 budget. */
function resolveCondition(yamlNode: YamlPipelineNode | undefined, data: FlowNodeData): YamlConditionSpec | undefined {
  return yamlNode?.condition ?? data.condition;
}

export const ConditionNode = memo(function ConditionNode(props: ConditionNodeProps): ReactNode {
  const { id, data = {}, selected = false, llmSettings } = props;

  const { yamlJsonObject, setYamlJsonObject, setFlowNodes, setFlowEdges, isRunningPipeline, disabled } = useFlowEditorNodeContext();
  // Baseline: `isRunningPipeline || disabled` (every call site below) —
  // computed once, as a definite `boolean` (`exactOptionalPropertyTypes`
  // forbids forwarding a `boolean | undefined` union to the many
  // already-landed sibling components' `disabled?: boolean` props below).
  const runningOrDisabled = Boolean(isRunningPipeline) || Boolean(disabled);
  const isPerforming = Boolean(data.isPerforming);

  // `useNodeAiAssistantConfig` is typed against the generic `Record<string,
  // unknown>` every ambient-context-replacing hook in this batch uses (see
  // that hook's own header) — `AiAssistantLlmSettings` has no index
  // signature of its own, so TS requires an explicit cast on both sides of
  // this effectively-identity call, same as `AIAssistantModal.tsx`'s own
  // `modelConfig?: AiAssistantLlmSettings | null` boundary.
  const pipelineLLMConfig = useNodeAiAssistantConfig(llmSettings as Record<string, unknown> | null | undefined) as AiAssistantLlmSettings | null;
  const inputOptions = useInputOptions();
  const flowNodes = useNodes<FlowNode>();
  const flowEdges = useEdges<FlowEdge>();

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id.replace(CONDITION_NODE_ID_SUFFIX, '')),
    [id, yamlJsonObject?.nodes],
  );

  const condition = resolveCondition(yamlNode, data);
  const conditionDefinition = condition?.condition_definition ?? '';
  const conditionInput = useMemo(() => condition?.condition_input ?? [], [condition?.condition_input]);
  const conditionOutput = useMemo(() => condition?.conditional_outputs ?? [], [condition?.conditional_outputs]);
  const stringConditionInput = useMemo(
    () => conditionInput.filter((item): item is string => typeof item === 'string'),
    [conditionInput],
  );

  const { onChangeInput, onChangeConditionDefinition, onRemoveOutput, onDeleteOption, realInputOptions } = useConditionNodeEditing({
    id,
    yamlNodeId: yamlNode?.id,
    condition,
    conditionInput,
    conditionOutput,
    inputOptions,
    yamlJsonObject,
    setYamlJsonObject,
    setFlowNodes,
    setFlowEdges,
  });

  return (
    <NodeCard
      name={data.label ?? id}
      isEntrypoint={false}
      selected={selected}
      handles={() => (
        <ConditionNodeHandles
          id={id}
          flowEdges={flowEdges}
          isRunningPipeline={Boolean(isRunningPipeline)}
          disabled={Boolean(disabled)}
          isPerforming={isPerforming}
        />
      )}
      type={PipelineNodeTypes.Condition}
      isPerforming={isPerforming}
      id={id}
    >
      <PipelineMultiSelect
        label={t('pipelines.flowEditor.deprecated.conditionNode.conditionalInput', 'Conditional input')}
        value={stringConditionInput}
        onValueChange={onChangeInput}
        options={realInputOptions}
        disabled={runningOrDisabled}
        onDeleteOption={onDeleteOption}
        className="nopan nodrag nowheel"
      />
      <AIAssistantInput
        value={conditionDefinition}
        fieldName="Condition"
        label={t('pipelines.flowEditor.deprecated.conditionNode.condition', 'Condition')}
        language="jinja"
        disabled={runningOrDisabled}
        modelConfig={pipelineLLMConfig}
        fieldBinding={{ onInput: onChangeConditionDefinition }}
      />
      <Box sx={conditionalOutputsContainerSx}>
        <Typography
          variant="bodySmall"
          color="text.default"
        >
          {t('pipelines.flowEditor.deprecated.conditionNode.conditionalOutputs', 'Conditional outputs')}
        </Typography>
        <ConditionOutputsList
          id={id}
          conditionOutput={conditionOutput}
          onRemoveOutput={onRemoveOutput}
          edges={flowEdges as unknown as readonly FlowGraphEdge[]}
          nodes={flowNodes}
        />
      </Box>
    </NodeCard>
  );
});

const conditionalOutputsContainerSx = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  padding: '.5rem 0rem',
  gap: '.5rem',
  overflow: 'hidden',
} as const;
