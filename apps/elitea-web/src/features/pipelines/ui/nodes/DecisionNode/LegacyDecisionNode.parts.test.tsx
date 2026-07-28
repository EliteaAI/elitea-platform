import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ReactFlow, ReactFlowProvider } from '@xyflow/react';

import { buildFlowEditorContextValue } from '../../../__tests__/testUtils';
import { FlowEditorContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowEdge, FlowNode, FlowNodeData } from '../../../lib/flow-editor/reactFlowTypes';
import { DecisionInputPicker, useLegacyDecisionNodeModel, type LegacyDecisionNodeModel } from './LegacyDecisionNode.parts';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

describe('DecisionInputPicker', () => {
  it('renders the "Decision input" heading and no chips when value is empty', () => {
    const { getByText, queryByRole } = renderWithTheme(
      <DecisionInputPicker
        value={[]}
        options={[{ label: 'input', value: 'input' }]}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Decision input')).toBeInTheDocument();
    expect(queryByRole('button', { name: /input/ })).not.toBeInTheDocument();
  });

  it('renders one chip per selected value', () => {
    const { getByText } = renderWithTheme(
      <DecisionInputPicker
        value={['input', 'messages']}
        options={[]}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('input')).toBeInTheDocument();
    expect(getByText('messages')).toBeInTheDocument();
  });

  it('calls onChange with the value removed when its chip delete icon is clicked', () => {
    const onChange = vi.fn();
    const { getByText } = renderWithTheme(
      <DecisionInputPicker
        value={['input', 'messages']}
        options={[]}
        onChange={onChange}
      />,
    );
    const chip = getByText('input').closest('[class*="MuiChip-root"]') as HTMLElement;
    const deleteIcon = chip.querySelector('svg') as SVGElement;
    fireEvent.click(deleteIcon);
    expect(onChange).toHaveBeenCalledWith(['messages']);
  });

  it('excludes already-selected values from the available options list', () => {
    // Exercised indirectly: with every option already selected, the
    // "add variable" SingleSelect must fall back to disabled (no options
    // left) -- proof that `availableOptions` really filtered them out.
    const { getByRole } = renderWithTheme(
      <DecisionInputPicker
        value={['input']}
        options={[{ label: 'input', value: 'input' }]}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the "add variable" select enabled once an unselected option remains', () => {
    const { getByRole } = renderWithTheme(
      <DecisionInputPicker
        value={['input']}
        options={[
          { label: 'input', value: 'input' },
          { label: 'messages', value: 'messages' },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('combobox')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('calls onChange with the picked value appended when a new variable is selected from the "add variable" dropdown', async () => {
    // Not nested inside `<ReactFlow>` (see `renderHook`'s own doc comment
    // below for why the hook tests below are) -- opening this native MUI
    // Select is therefore safe here, unlike the toolkit-picker Selects in
    // sibling node-component test files.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <DecisionInputPicker
        value={['input']}
        options={[{ label: 'messages', value: 'messages' }]}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'messages' }));
    expect(onChange).toHaveBeenCalledWith(['input', 'messages']);
  });

  it('disables every chip when disabled is true, and overrides the "no options left" auto-disable to stay disabled either way', () => {
    const { getByText, getByRole } = renderWithTheme(
      <DecisionInputPicker
        value={['input']}
        options={[{ label: 'messages', value: 'messages' }]}
        onChange={vi.fn()}
        disabled
      />,
    );
    const chip = getByText('input').closest('[class*="MuiChip-root"]');
    expect(chip?.className).toContain('Mui-disabled');
    expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });
});

/** Renders `useLegacyDecisionNodeModel` via a real component tree (`useEdges`/`FlowEditorContext` need real ancestors) and hands every render's result out through `onResult`. */
function HookProbe({
  id,
  data,
  llmSettings,
  onResult,
}: {
  readonly id: string;
  readonly data: FlowNodeData | undefined;
  readonly llmSettings?: null;
  readonly onResult: (result: LegacyDecisionNodeModel) => void;
}) {
  onResult(useLegacyDecisionNodeModel({ id, data, llmSettings: llmSettings ?? null }));
  return null;
}

function renderHook(
  id: string,
  data: FlowNodeData | undefined,
  onResult: (result: LegacyDecisionNodeModel) => void,
  flowEditorOverrides: Partial<FlowEditorContextValue> = {},
  edges: readonly FlowEdge[] = [],
) {
  const flowEditorValue = buildFlowEditorContextValue(flowEditorOverrides);
  const flowNode: FlowNode = { id, type: 'testNode', position: { x: 0, y: 0 }, data: data ?? {} };

  return renderWithTheme(
    <ReactFlowProvider>
      <FlowEditorContext.Provider value={flowEditorValue}>
        <ReactFlow
          nodes={[flowNode]}
          edges={[...edges]}
          nodeTypes={{ testNode: () => <HookProbe id={id} data={data} onResult={onResult} /> }}
        />
      </FlowEditorContext.Provider>
    </ReactFlowProvider>,
  );
}

describe('useLegacyDecisionNodeModel', () => {
  it('resolves decision fields from the yamlNode (matched by the id with the legacy suffix stripped)', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [
        {
          id: 'Decision1',
          decision: { description: 'from yaml', decisional_inputs: ['input'], nodes: ['NodeA'], default_output: 'End' },
        },
      ],
    };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject },
    );

    await waitFor(() => expect(latest?.description).toBe('from yaml'));
    expect(latest?.decisionInput).toEqual(['input']);
    expect(latest?.decisionOutput).toEqual(['NodeA']);
  });

  it('falls back to the flow-node data.decision when no matching yamlNode decision exists', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const data: FlowNodeData = { decision: { description: 'from data', decisional_inputs: [], nodes: [], default_output: '' } };
    renderHook('Decision1~~~DecisionNode', data, result => {
      latest = result;
    });

    await waitFor(() => expect(latest?.description).toBe('from data'));
  });

  it('defaults to empty description/inputs/outputs when neither yamlNode nor data carries a decision', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    renderHook('Decision1~~~DecisionNode', undefined, result => {
      latest = result;
    });

    await waitFor(() => expect(latest).toBeDefined());
    expect(latest?.description).toBe('');
    expect(latest?.decisionInput).toEqual([]);
    expect(latest?.decisionOutput).toEqual([]);
  });

  it('onChangeInput writes decisional_inputs to both yamlJsonObject and matching flow node data', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'Decision1', decision: { description: 'd', decisional_inputs: [], nodes: [], default_output: '' } }],
    };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject, setYamlJsonObject, setFlowNodes },
    );
    await waitFor(() => expect(latest).toBeDefined());

    latest?.onChangeInput(['input']);

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.find(node => node.id === 'Decision1')?.decision).toMatchObject({ decisional_inputs: ['input'] });

    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    const updater = setFlowNodes.mock.calls[0]?.[0] as (prev: FlowNode[]) => FlowNode[];
    // A second, unrelated flow node in `prevNodes` -- exercises the
    // `node.id === id ? ... : node` ternary's FALSE branch (left untouched)
    // alongside the matching node's TRUE branch.
    const otherNode: FlowNode = { id: 'OtherNode', position: { x: 5, y: 5 }, data: { label: 'untouched' } };
    const updated = updater([{ id: 'Decision1~~~DecisionNode', position: { x: 0, y: 0 }, data: {} }, otherNode]);
    expect(updated[0]?.data['decision']).toMatchObject({ decisional_inputs: ['input'] });
    expect(updated[1]).toBe(otherNode);
  });

  it('onChangeDecisionDescription calls preventDefault and writes the new description', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'Decision1', decision: { description: 'old', decisional_inputs: [], nodes: [], default_output: '' } }],
    };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject, setYamlJsonObject },
    );
    await waitFor(() => expect(latest).toBeDefined());

    const preventDefault = vi.fn();
    latest?.onChangeDecisionDescription({ preventDefault, target: { value: 'new' } });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.find(node => node.id === 'Decision1')?.decision).toMatchObject({ description: 'new' });
  });

  it('onRemoveOutput drops the output and its outgoing "nodes"-handle edge', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'Decision1', decision: { description: '', decisional_inputs: [], nodes: ['NodeA', 'NodeB'], default_output: '' } }],
    };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject, setYamlJsonObject, setFlowEdges },
    );
    await waitFor(() => expect(latest).toBeDefined());

    latest?.onRemoveOutput('NodeA')();

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.find(node => node.id === 'Decision1')?.decision).toMatchObject({ nodes: ['NodeB'] });

    const updater = setFlowEdges.mock.calls[0]?.[0] as (prev: FlowEdge[]) => FlowEdge[];
    const remaining = updater([
      { id: 'e1', source: 'Decision1~~~DecisionNode', sourceHandle: 'nodes', target: 'NodeA' },
      { id: 'e2', source: 'Decision1~~~DecisionNode', sourceHandle: 'nodes', target: 'NodeB' },
      { id: 'e3', source: 'Decision1~~~DecisionNode', sourceHandle: 'default_output', target: 'NodeA' },
    ]);
    // Only the 'nodes'-handle edge to the removed target is dropped -- a
    // 'default_output' edge to the same target id survives.
    expect(remaining.map(edge => edge.id)).toEqual(['e2', 'e3']);
  });

  it('isElseConnectable is false once an edge from the default_output handle already exists', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const edges: readonly FlowEdge[] = [
      { id: 'e1', source: 'Decision1~~~DecisionNode', sourceHandle: 'default_output', target: 'End' },
    ];
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      {},
      edges,
    );
    await waitFor(() => expect(latest?.isElseConnectable).toBe(false));
  });

  it('isElseConnectable is true when no default_output edge exists yet', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    renderHook('Decision1~~~DecisionNode', undefined, result => {
      latest = result;
    });
    await waitFor(() => expect(latest?.isElseConnectable).toBe(true));
  });

  it('prepends decisionInput entries not present in the live state as synthetic realInputOptions', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'Decision1', decision: { description: '', decisional_inputs: ['stale_var'], nodes: [], default_output: '' } }],
      state: { counter: { type: 'number' } },
    };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject },
    );
    await waitFor(() => expect(latest).toBeDefined());

    const values = latest?.realInputOptions.map(option => option.value) ?? [];
    expect(values[0]).toBe('stale_var');
    expect(values).toContain('counter');
  });

  it('falls back to a safe default FlowEditorContextValue outside any FlowEditorContext.Provider ancestor, instead of throwing', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const flowNode: FlowNode = { id: 'Decision1~~~DecisionNode', type: 'testNode', position: { x: 0, y: 0 }, data: {} };
    renderWithTheme(
      <ReactFlowProvider>
        <ReactFlow
          nodes={[flowNode]}
          edges={[]}
          nodeTypes={{
            testNode: () => (
              <HookProbe
                id="Decision1~~~DecisionNode"
                data={undefined}
                onResult={result => {
                  latest = result;
                }}
              />
            ),
          }}
        />
      </ReactFlowProvider>,
    );
    await waitFor(() => expect(latest).toBeDefined());
    expect(latest?.decisionInput).toEqual([]);
    expect(latest?.isRunningPipeline).toBe(false);
    // The default context's `setYamlJsonObject`/`setFlowNodes` are no-op
    // stubs -- calling through them must not throw.
    expect(() => latest?.onChangeInput(['x'])).not.toThrow();
  });

  it('writeDecision skips the YAML write (no matching yamlNode) but still updates the flow node data', async () => {
    let latest: LegacyDecisionNodeModel | undefined;
    const setYamlJsonObject = vi.fn();
    const setFlowNodes = vi.fn();
    // No node with id 'Decision1' in yamlJsonObject.nodes -- `yamlNode` inside
    // the hook resolves to `undefined`, exercising `writeDecision`'s own
    // `if (yamlNode)` FALSE branch.
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'SomeOtherNode' }] };
    renderHook(
      'Decision1~~~DecisionNode',
      undefined,
      result => {
        latest = result;
      },
      { yamlJsonObject, setYamlJsonObject, setFlowNodes },
    );
    await waitFor(() => expect(latest).toBeDefined());

    latest?.onChangeInput(['input']);

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowNodes).toHaveBeenCalledTimes(1);
    const updater = setFlowNodes.mock.calls[0]?.[0] as (prev: FlowNode[]) => FlowNode[];
    const updated = updater([{ id: 'Decision1~~~DecisionNode', position: { x: 0, y: 0 }, data: {} }]);
    expect(updated[0]?.data['decision']).toMatchObject({ decisional_inputs: ['input'] });
  });
});
