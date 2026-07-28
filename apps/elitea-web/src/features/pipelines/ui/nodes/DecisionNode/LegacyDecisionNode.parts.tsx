/**
 * `useLegacyDecisionNodeModel` + `LegacyDecisionNodeHandles` +
 * `DecisionInputPicker` for `./LegacyDecisionNode.tsx`, split out purely to
 * satisfy the §3.5 complexity budget (12) — same technique
 * `../HITLNode.parts.tsx`'s own `useHITLNodeModel` uses; see that hook's
 * own doc comment for the full rationale.
 *
 * `DecisionInputPicker`'s own doc comment (moved here verbatim from
 * `./LegacyDecisionNode.tsx`'s original header): REAL, CONFIRMED CAPABILITY
 * GAP (not a timing/landing issue) — the baseline's "Decision input" field
 * is `Select.SingleSelect` with `multiple` (baseline `shared/ui/select/
 * SingleSelect.jsx`) — a multi-value select with removable in-select chips
 * and per-item "not in state" tooltips (`onDeleteOption`, `realInputOptions`'s
 * `canDelete`/`tooltip` fields). This app's promoted `@/shared/ui/SingleSelect`
 * is explicitly single-value-only; no multi-select-with-removable-chips
 * component exists anywhere in `shared/ui/` (verified by directory
 * listing). `DecisionInputPicker` below is a small, locally-scoped
 * replacement composed from already-landed primitives (`HeadingChip` + MUI
 * `Chip` chip-row, matching `./DecisionNodeShared.tsx`'s own
 * `DecisionOutputs` chip-row pattern, + `SingleSelect` as the "add one more"
 * control) — NOT a `shared/ui` promotion. The baseline's per-item "not in
 * state" tooltip distinction is dropped — a disclosed, minor fidelity
 * simplification, not a functional loss.
 */
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';

import { useEdges } from '@xyflow/react';

import { HeadingChip } from '@/shared/ui/HeadingChip';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { RemoveIcon } from '@/shared/ui/icons/remove-icon';
import { t } from '@/shared/i18n';

import { FlowEditorConstants } from '../../../lib/flow-editor/constants';
import { updateYamlNode } from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import { FlowEditorContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import { useInputOptions } from '../../../lib/flow-editor/hooks/useInputOptions';
import { useNodeAiAssistantConfig } from '../../../lib/flow-editor/hooks/useNodeAiAssistantConfig';
import type { AiAssistantLlmSettings } from '../../../api/aiAssistantPredict';
import type { NodeOption } from '../../../lib/flow-editor/hooks/useNodeOptions';
import type { FlowNode as FlowNodeType, FlowNodeData } from '../../../lib/flow-editor/reactFlowTypes';
import { CustomHandle } from '../CustomHandle';

/** `FlowEditorContext`, defaulted once — see `../AgentNode.tsx`'s identical constant for the full rationale. */
const EMPTY_STRING_ARRAY: readonly string[] = [];

const EMPTY_FLOW_EDITOR_CONTEXT: FlowEditorContextValue = {
  yamlJsonObject: {},
  setFlowNodes: () => {},
  setFlowEdges: () => {},
  setYamlJsonObject: () => {},
};

export interface DecisionInputPickerProps {
  readonly value: readonly string[];
  readonly options: readonly NodeOption[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean | undefined;
}

export function DecisionInputPicker(props: DecisionInputPickerProps): ReactNode {
  const { value, options, onChange, disabled } = props;
  const theme = useTheme();
  const availableOptions = useMemo(() => options.filter(option => !value.includes(option.value)), [options, value]);

  const onRemove = useCallback((item: string) => () => onChange(value.filter(v => v !== item)), [onChange, value]);
  const onAdd = useCallback((next: string) => next && onChange([...value, next]), [onChange, value]);

  return (
    <Box sx={pickerStyles.container}>
      <HeadingChip label={t('pipelines.flowEditor.decisionNode.decisionInput', 'Decision input')} />
      {value.length > 0 && (
        <Box sx={pickerStyles.chipRow}>
          {value.map(item => (
            <Chip
              key={item}
              label={item}
              disabled={disabled}
              className="nopan nodrag nowheel"
              deleteIcon={
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', color: theme.vars.palette.icon.fill.secondary }}
                >
                  <RemoveIcon />
                </Box>
              }
              onDelete={onRemove(item)}
            />
          ))}
        </Box>
      )}
      <Box className="nopan nodrag">
        <SingleSelect
          value=""
          onChange={onAdd}
          options={[...availableOptions]}
          placeholder={t('pipelines.flowEditor.decisionNode.addVariable', 'Add variable')}
          disabled={disabled ?? availableOptions.length === 0}
        />
      </Box>
    </Box>
  );
}

const pickerStyles: { readonly container: SxProps<Theme>; readonly chipRow: SxProps<Theme> } = {
  container: (theme: Theme) => ({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5), width: '100%' }),
  chipRow: (theme: Theme) => ({ display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0.5) }),
};

export interface LegacyDecisionNodeHandlesProps {
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly isElseConnectable: boolean;
  readonly isPerforming: boolean;
  readonly nodesHandleStyle: { readonly left: string };
  readonly defaultOutputHandleStyle: { readonly left: string };
}

/** Extracted purely to keep `LegacyDecisionNode`'s own cyclomatic complexity under the §3.5 budget (12) — same technique `../AgentNode.tsx`'s `AgentNodeHandles` uses. */
export function LegacyDecisionNodeHandles(props: LegacyDecisionNodeHandlesProps): ReactNode {
  const { isRunningPipeline, disabled, isElseConnectable, isPerforming, nodesHandleStyle, defaultOutputHandleStyle } = props;
  return (
    <>
      <CustomHandle
        type="target"
        id="target"
        isConnectable={!isRunningPipeline && !disabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
      <CustomHandle
        type="source"
        id="nodes"
        isConnectable={!isRunningPipeline && !disabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
        style={nodesHandleStyle}
      />
      <CustomHandle
        type="source"
        id="default_output"
        label={t('pipelines.flowEditor.decisionNode.defaultOutput', 'Default output')}
        isConnectable={isElseConnectable && !isRunningPipeline && !disabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
        style={defaultOutputHandleStyle}
      />
    </>
  );
}

interface LegacyDecision {
  readonly description?: string;
  readonly decisional_inputs?: readonly string[];
  readonly nodes?: readonly string[];
  readonly default_output?: string;
}

/** Pure extraction of the baseline's "decision sub-object, YAML node or (pre-migration) flow-node data" fallback — kept out of the model hook's own body purely to stay under the §3.5 complexity budget (12). */
function resolveLegacyDecision(yamlNodeDecision: unknown, flowNodeDataDecision: unknown): LegacyDecision | undefined {
  return (yamlNodeDecision ?? flowNodeDataDecision) as LegacyDecision | undefined;
}

/** Pure extraction of the baseline's "not in state" synthetic-option prepend — same complexity-budget reason as {@link resolveLegacyDecision}. */
function buildRealInputOptions(decisionInput: readonly string[], inputOptions: readonly NodeOption[]): readonly NodeOption[] {
  const optionsNotInState = decisionInput
    .filter(item => !inputOptions.find(option => option.value === item))
    .map(item => ({ label: item, value: item }));
  return [...optionsNotInState, ...inputOptions];
}

export interface UseLegacyDecisionNodeModelArgs {
  readonly id: string;
  readonly data: FlowNodeData | undefined;
  readonly llmSettings: AiAssistantLlmSettings | null | undefined;
}

export interface LegacyDecisionNodeModel {
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly isFieldsDisabled: boolean;
  readonly isElseConnectable: boolean;
  readonly resolvedLlmSettings: AiAssistantLlmSettings | null;
  readonly description: string;
  readonly decisionInput: readonly string[];
  readonly decisionOutput: readonly string[];
  readonly realInputOptions: readonly NodeOption[];
  readonly onChangeInput: (newValue: readonly string[]) => void;
  readonly onChangeDecisionDescription: (event: { readonly preventDefault: () => void; readonly target: { readonly value: string } }) => void;
  readonly onRemoveOutput: (output: string) => () => void;
}

/**
 * Every piece of `LegacyDecisionNode`'s own derived state/handlers,
 * gathered behind one custom hook — see `../HITLNode.parts.tsx`'s
 * `useHITLNodeModel` doc comment for the full complexity-budget rationale
 * this mirrors.
 */
export function useLegacyDecisionNodeModel(args: UseLegacyDecisionNodeModelArgs): LegacyDecisionNodeModel {
  const { id, data, llmSettings } = args;

  const edges = useEdges();
  const flowEditorContext = useContext(FlowEditorContext) ?? EMPTY_FLOW_EDITOR_CONTEXT;
  const { yamlJsonObject, setYamlJsonObject, setFlowNodes, setFlowEdges } = flowEditorContext;
  const isRunningPipeline = Boolean(flowEditorContext.isRunningPipeline);
  const disabled = Boolean(flowEditorContext.disabled);
  const resolvedLlmSettings = useNodeAiAssistantConfig(llmSettings as Record<string, unknown> | null | undefined) as AiAssistantLlmSettings | null;
  const inputOptions = useInputOptions();

  const realYamlNodeId = useMemo(() => id.replace(FlowEditorConstants.DECISION_NODE_ID_SUFFIX, ''), [id]);
  const yamlNode = useMemo(
    () => yamlJsonObject.nodes?.find(node => node.id === realYamlNodeId),
    [realYamlNodeId, yamlJsonObject.nodes],
  );
  const decisionFields = useMemo(() => {
    const decision = resolveLegacyDecision(yamlNode?.decision, data?.decision);
    return {
      description: decision?.description ?? '',
      decisionInput: decision?.decisional_inputs ?? EMPTY_STRING_ARRAY,
      decisionOutput: decision?.nodes ?? EMPTY_STRING_ARRAY,
      decisionElse: decision?.default_output ?? '',
    };
  }, [yamlNode?.decision, data?.decision]);
  const { description, decisionInput, decisionOutput, decisionElse } = decisionFields;
  const isElseConnectable = useMemo(
    () => !edges.find(edge => edge.source === id && edge.sourceHandle === 'default_output'),
    [edges, id],
  );

  const writeDecision = useCallback(
    (nextDecision: LegacyDecision) => {
      if (yamlNode) {
        updateYamlNode(yamlNode.id, 'decision', nextDecision, yamlJsonObject, setYamlJsonObject);
      }
      setFlowNodes((prevNodes: readonly FlowNodeType[]) =>
        prevNodes.map(node => (node.id === id ? { ...node, data: { ...node.data, decision: { ...nextDecision } } } : node)),
      );
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, setFlowNodes, setYamlJsonObject, yamlJsonObject, yamlNode],
  );

  const onChangeInput = useCallback(
    (newValue: readonly string[]) => {
      writeDecision({ description, decisional_inputs: newValue, nodes: decisionOutput, default_output: decisionElse });
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [description, decisionOutput, decisionElse, writeDecision],
  );

  const onChangeDecisionDescription = useCallback(
    (event: { readonly preventDefault: () => void; readonly target: { readonly value: string } }) => {
      event.preventDefault();
      writeDecision({ description: event.target.value, decisional_inputs: decisionInput, nodes: decisionOutput, default_output: decisionElse });
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decisionElse, decisionInput, decisionOutput, writeDecision],
  );

  const onRemoveOutput = useCallback(
    (output: string) => () => {
      writeDecision({ description, decisional_inputs: decisionInput, nodes: decisionOutput.filter(item => item !== output), default_output: decisionElse });
      setFlowEdges(prevEdges => prevEdges.filter(edge => edge.source !== id || edge.sourceHandle !== 'nodes' || edge.target !== output));
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [description, decisionInput, decisionOutput, decisionElse, writeDecision, setFlowEdges, id],
  );

  const realInputOptions = useMemo(() => buildRealInputOptions(decisionInput, inputOptions), [decisionInput, inputOptions]);

  return {
    isRunningPipeline,
    disabled,
    isFieldsDisabled: isRunningPipeline || disabled,
    isElseConnectable,
    resolvedLlmSettings,
    description,
    decisionInput,
    decisionOutput,
    realInputOptions,
    onChangeInput,
    onChangeDecisionDescription,
    onRemoveOutput,
  };
}
