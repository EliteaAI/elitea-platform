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

  /**
   * Baseline (`ConditionNode.jsx:201-206`): `onChangeInput(conditionInput.filter(item
   * => item !== value))` — filters the RAW, unfiltered `condition_input`
   * array and writes the result straight back. Filtering through
   * {@link stringConditionInput} first (as `onChangeInput(stringConditionInput(...)
   * .filter(...))` would) silently drops any non-string entry a
   * legacy/malformed pipeline's `condition_input` still carries on the very
   * next delete, even though that entry has nothing to do with the one
   * being removed. Writing straight to {@link persistCondition} (rather
   * than through the public `onChangeInput`, which is typed `readonly
   * string[]` for the multi-select's own `onValueChange` contract) keeps
   * every untouched entry -- string or not -- intact, matching baseline.
   */
  const onDeleteOption = useCallback(
    (value: string) => persistCondition({ condition_input: conditionInput.filter(item => item !== value) }),
    [conditionInput, persistCondition],
  );

  /**
   * Baseline (`ConditionNode.jsx:189-199`) maps the RAW `condition_input`
   * array directly into `{label: item, value: item, ...}` option objects.
   * This app's `ConditionOption`/`PipelineMultiSelectOption` (unlike
   * baseline's untyped JS) require `label`/`value: string`, so a non-string
   * entry cannot be represented here without an unsafe cast -- filtered via
   * {@link stringConditionInput} instead, a real, verified constraint of
   * this typed multi-select, not a behavioural choice.
   *
   * This does NOT reintroduce the data-loss `onDeleteOption` above fixes:
   * a non-string entry is simply never offered a chip here, but it still
   * round-trips through `condition_input` untouched on every edit, since
   * `onDeleteOption` (and `persistCondition` generally) now operate on the
   * raw array, not this filtered display list.
   *
   * Residual, OUT-OF-SCOPE gap for a later pass: `ConditionNode.tsx` (this
   * cluster's own file, but not named in this fix's confirmed-findings
   * list) independently computes its own string-filtered `value` prop for
   * `PipelineMultiSelect` from `conditionInput` rather than reading it from
   * this hook, so even a string-safe non-string representation added here
   * could never render as a selected chip regardless of what this function
   * returns -- fully restoring baseline's raw-array chip display (as
   * opposed to just data preservation, which is what this fix guarantees)
   * would additionally require changing that prop's source in
   * `ConditionNode.tsx`.
   */
  const realInputOptions = useMemo<readonly ConditionOption[]>(() => {
    const notInState = t('pipelines.flowEditor.deprecated.conditionNode.notInState', 'Not in state');
    const optionsNotInState = stringConditionInput(conditionInput)
      .filter(item => !inputOptions.find(option => option.value === item))
      .map(item => ({ label: item, value: item, canDelete: true, tooltip: notInState }));
    return [...optionsNotInState, ...inputOptions];
  }, [conditionInput, inputOptions]);

  return { onChangeInput, onChangeConditionDefinition, onRemoveOutput, onDeleteOption, realInputOptions };
}
