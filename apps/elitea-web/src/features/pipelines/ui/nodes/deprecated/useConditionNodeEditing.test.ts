import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { YamlConditionSpec, YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { NodeOption } from '../../../lib/flow-editor/hooks/useNodeOptions';
import type { FlowNode } from '../../../lib/flow-editor/reactFlowTypes';
import { useConditionNodeEditing, type UseConditionNodeEditingArgs } from './useConditionNodeEditing';

const baseCondition: YamlConditionSpec = {
  condition_definition: '{{ input }} == "yes"',
  condition_input: ['input'],
  conditional_outputs: ['branch-a', 'branch-b'],
  default_output: 'branch-else',
};

function buildArgs(overrides: Partial<UseConditionNodeEditingArgs> = {}): UseConditionNodeEditingArgs {
  return {
    id: 'condition-1',
    yamlNodeId: 'condition-1',
    condition: baseCondition,
    conditionInput: baseCondition.condition_input ?? [],
    conditionOutput: baseCondition.conditional_outputs ?? [],
    inputOptions: [{ label: 'input', value: 'input' }] as readonly NodeOption[],
    yamlJsonObject: { nodes: [{ id: 'condition-1', type: 'condition', condition: baseCondition }] },
    setYamlJsonObject: vi.fn(),
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
    ...overrides,
  };
}

describe('useConditionNodeEditing onChangeInput', () => {
  it('persists the new condition_input to both yamlJsonObject and setFlowNodes', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const args = buildArgs({ setYamlJsonObject, setFlowNodes });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onChangeInput(['input', 'extra']);

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toMatchObject({ condition_input: ['input', 'extra'] });

    // setFlowNodes is passed an updater function; apply it to a stub node list to assert the live sync.
    const [updater] = setFlowNodes.mock.calls[0] as [(nodes: FlowNode[]) => FlowNode[]];
    const prevNodes = [{ id: 'condition-1', data: {} } as unknown as FlowNode, { id: 'other', data: { keep: true } } as unknown as FlowNode];
    const nextNodes = updater(prevNodes);
    expect(nextNodes[0]?.data).toMatchObject({ condition: { condition_input: ['input', 'extra'] } });
    expect(nextNodes[1]?.data).toEqual({ keep: true });
  });

  it('does not write to yamlJsonObject when yamlNodeId is undefined, but still syncs setFlowNodes', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const args = buildArgs({ yamlNodeId: undefined, setYamlJsonObject, setFlowNodes });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onChangeInput(['input']);

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing setFlowNodes/setFlowEdges', () => {
    const args = buildArgs({ setFlowNodes: undefined, setFlowEdges: undefined });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    expect(() => result.current.onChangeInput(['input'])).not.toThrow();
  });

  it('builds a fresh condition with defaults when condition is undefined', () => {
    const setYamlJsonObject = vi.fn();
    const args = buildArgs({ condition: undefined, setYamlJsonObject });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onChangeInput(['input']);

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toEqual({
      condition_definition: '',
      condition_input: ['input'],
      conditional_outputs: [],
      default_output: '',
    });
  });
});

describe('useConditionNodeEditing onChangeConditionDefinition', () => {
  it('calls preventDefault and persists the new condition_definition', () => {
    const setYamlJsonObject = vi.fn();
    const preventDefault = vi.fn();
    const args = buildArgs({ setYamlJsonObject });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onChangeConditionDefinition({ preventDefault, target: { value: 'new def' } });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toMatchObject({ condition_definition: 'new def' });
  });
});

describe('useConditionNodeEditing onRemoveOutput', () => {
  it('removes the output from conditional_outputs and filters matching edges', () => {
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    const args = buildArgs({ setYamlJsonObject, setFlowEdges });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onRemoveOutput('branch-a')();

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toMatchObject({ conditional_outputs: ['branch-b'] });

    const [edgeUpdater] = setFlowEdges.mock.calls[0] as [(edges: unknown[]) => unknown[]];
    const prevEdges = [
      { id: 'e1', source: 'condition-1', sourceHandle: 'conditional_outputs', target: 'branch-a' },
      { id: 'e2', source: 'condition-1', sourceHandle: 'conditional_outputs', target: 'branch-b' },
      { id: 'e3', source: 'other', sourceHandle: 'conditional_outputs', target: 'branch-a' },
    ];
    const nextEdges = edgeUpdater(prevEdges);
    expect(nextEdges).toEqual([
      { id: 'e2', source: 'condition-1', sourceHandle: 'conditional_outputs', target: 'branch-b' },
      { id: 'e3', source: 'other', sourceHandle: 'conditional_outputs', target: 'branch-a' },
    ]);
  });
});

describe('useConditionNodeEditing onDeleteOption', () => {
  it('removes the value from the string condition_input via onChangeInput', () => {
    const setYamlJsonObject = vi.fn();
    const args = buildArgs({ conditionInput: ['input', 'extra'], setYamlJsonObject });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onDeleteOption('extra');

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toMatchObject({ condition_input: ['input'] });
  });

  it('filters out non-string entries from conditionInput before comparing', () => {
    const setYamlJsonObject = vi.fn();
    const args = buildArgs({ conditionInput: ['input', { nested: true }, 'extra'], setYamlJsonObject });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    result.current.onDeleteOption('extra');

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]?.condition).toMatchObject({ condition_input: ['input'] });
  });
});

describe('useConditionNodeEditing realInputOptions', () => {
  it('appends condition_input entries not present in inputOptions, marked deletable', () => {
    const args = buildArgs({
      conditionInput: ['input', 'stale-var'],
      inputOptions: [{ label: 'input', value: 'input' }] as readonly NodeOption[],
    });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    expect(result.current.realInputOptions).toEqual([
      { label: 'stale-var', value: 'stale-var', canDelete: true, tooltip: 'Not in state' },
      { label: 'input', value: 'input' },
    ]);
  });

  it('returns just inputOptions when every condition_input entry is already present', () => {
    const args = buildArgs({
      conditionInput: ['input'],
      inputOptions: [{ label: 'input', value: 'input' }] as readonly NodeOption[],
    });
    const { result } = renderHook(() => useConditionNodeEditing(args));

    expect(result.current.realInputOptions).toEqual([{ label: 'input', value: 'input' }]);
  });
});
