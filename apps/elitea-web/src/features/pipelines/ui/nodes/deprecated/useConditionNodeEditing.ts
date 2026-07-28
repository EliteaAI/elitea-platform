/**
 * `ConditionNode.tsx`'s editing logic (baseline: `ConditionNode.jsx:34-97`,
 * the `onChangeInput`/`onChangeConditionDefinition`/`onRemoveOutput`/
 * `onDeleteOption` handlers and the `realInputOptions` derivation), split
 * into its own hook purely to keep `ConditionNode.tsx` under the §3.5
 * `complexity` budget (12) — moving this many branching `useCallback`/
 * `useMemo` bodies out of the component function is what actually reduces
 * its reported complexity (each stays under 12 in isolation here too, but
 * as a SEPARATE function/file their branches no longer sum into
 * `ConditionNode`'s own count). No behaviour change from the extraction.
 */
import { useCallback, useMemo } from 'react';

import { t } from '@/shared/i18n';

import { updateYamlNode } from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlConditionSpec, YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { NodeOption } from '../../../lib/flow-editor/hooks/useNodeOptions';
import type { FlowNode, SetFlowEdges, SetFlowNodes } from '../../../lib/flow-editor/reactFlowTypes';

interface ConditionOption {
  readonly label: string;
  readonly value: string;
  readonly canDelete?: boolean;
  readonly tooltip?: string;
}

export interface UseConditionNodeEditingArgs {
  readonly id: string;
  readonly yamlNodeId: string | undefined;
  readonly condition: YamlConditionSpec | undefined;
  readonly conditionInput: readonly unknown[];
  readonly conditionOutput: readonly string[];
  readonly inputOptions: readonly NodeOption[];
  readonly yamlJsonObject: YamlPipelineDocument | undefined;
  readonly setYamlJsonObject: ((next: YamlPipelineDocument) => void) | undefined;
  readonly setFlowNodes: SetFlowNodes | undefined;
  readonly setFlowEdges: SetFlowEdges | undefined;
}

export interface UseConditionNodeEditingResult {
  readonly onChangeInput: (newValue: readonly string[]) => void;
  readonly onChangeConditionDefinition: (event: { readonly preventDefault: () => void; readonly target: { readonly value: string } }) => void;
  readonly onRemoveOutput: (output: string) => () => void;
  readonly onDeleteOption: (value: string) => void;
  readonly realInputOptions: readonly ConditionOption[];
}

function buildCondition(base: YamlConditionSpec | undefined, overrides: Partial<YamlConditionSpec>): YamlConditionSpec {
  return {
    condition_definition: base?.condition_definition ?? '',
    condition_input: base?.condition_input ?? [],
    conditional_outputs: base?.conditional_outputs ?? [],
    default_output: base?.default_output ?? '',
    ...overrides,
  };
}

const stringConditionInput = (conditionInput: readonly unknown[]): readonly string[] =>
  conditionInput.filter((item): item is string => typeof item === 'string');

/**
 * `ConditionNode.jsx:57-97` (`onChangeInput`/`onChangeConditionDefinition`/
 * `onRemoveOutput`) each write the new condition to BOTH the persisted
 * `yamlJsonObject` (via `updateYamlNode`) AND the live React-Flow node's
 * own `data.condition` (via `setFlowNodes`) — the latter keeps this node's
 * own re-render in sync without waiting for a `yamlJsonObject` round-trip.
 * Both writes are preserved here.
 */
export function useConditionNodeEditing(args: UseConditionNodeEditingArgs): UseConditionNodeEditingResult {
  const { id, yamlNodeId, condition, conditionInput, conditionOutput, inputOptions, yamlJsonObject, setYamlJsonObject, setFlowNodes, setFlowEdges } = args;

  const persistCondition = useCallback(
    (overrides: Partial<YamlConditionSpec>) => {
      const nextCondition = buildCondition(condition, overrides);
      if (yamlNodeId !== undefined && yamlJsonObject && setYamlJsonObject) {
        updateYamlNode(yamlNodeId, 'condition', nextCondition, yamlJsonObject, setYamlJsonObject);
      }
      setFlowNodes?.((prevNodes: FlowNode[]) =>
        prevNodes.map(node => (node.id === id ? { ...node, data: { ...node.data, condition: nextCondition } } : node)),
      );
    },
    [condition, id, setFlowNodes, setYamlJsonObject, yamlJsonObject, yamlNodeId],
  );

  const onChangeInput = useCallback((newValue: readonly string[]) => persistCondition({ condition_input: newValue }), [persistCondition]);

  const onChangeConditionDefinition = useCallback(
    (event: { readonly preventDefault: () => void; readonly target: { readonly value: string } }) => {
      event.preventDefault();
      persistCondition({ condition_definition: event.target.value });
    },
    [persistCondition],
  );

  const onRemoveOutput = useCallback(
    (output: string) => () => {
      persistCondition({ conditional_outputs: conditionOutput.filter(item => item !== output) });
      setFlowEdges?.(prevEdges =>
        prevEdges.filter(edge => edge.source !== id || edge.sourceHandle !== 'conditional_outputs' || edge.target !== output),
      );
    },
    [conditionOutput, id, persistCondition, setFlowEdges],
  );

  const onDeleteOption = useCallback(
    (value: string) => onChangeInput(stringConditionInput(conditionInput).filter(item => item !== value)),
    [conditionInput, onChangeInput],
  );

  const realInputOptions = useMemo<readonly ConditionOption[]>(() => {
    const notInState = t('pipelines.flowEditor.deprecated.conditionNode.notInState', 'Not in state');
    const optionsNotInState = stringConditionInput(conditionInput)
      .filter(item => !inputOptions.find(option => option.value === item))
      .map(item => ({ label: item, value: item, canDelete: true, tooltip: notInState }));
    return [...optionsNotInState, ...inputOptions];
  }, [conditionInput, inputOptions]);

  return { onChangeInput, onChangeConditionDefinition, onRemoveOutput, onDeleteOption, realInputOptions };
}
