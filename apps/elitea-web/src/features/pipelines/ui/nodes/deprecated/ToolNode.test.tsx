import { fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { renderDeprecatedNode } from './deprecatedNodeTestUtils';
import { ToolNode } from './ToolNode';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

const versionTools: readonly PipelineToolEntry[] = [
  { type: 'github', toolkit_name: 'my-github', settings: { selected_tools: ['create_issue', 'list_issues'] } },
];

function renderToolNode(yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'tool-1', type: 'tool', toolkit_name: 'my-github', task: 'do the thing' }] }) {
  const setYamlJsonObject = vi.fn();
  const contextValue: FlowEditorContextValue = {
    yamlJsonObject,
    setYamlJsonObject,
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
  };

  const result = renderDeprecatedNode(
    'tool-1',
    contextValue,
    <ToolNode
      id="tool-1"
      data={{}}
      versionTools={versionTools}
    />,
  );

  return { ...result, setYamlJsonObject };
}

describe('ToolNode', () => {
  it('renders the task value', async () => {
    const { findByDisplayValue } = renderToolNode();
    expect(await findByDisplayValue('do the thing')).toBeInTheDocument();
  });

  it('shows a Tool sub-select once the selected toolkit has explicit selected_tools', async () => {
    // Rendered order: ToolSelect (toolkit picker), then the "Tool"
    // SingleSelect -- verified by presence only (not opened): a real
    // `mousedown` on a `Select` nested inside `<ReactFlow>`'s pane also
    // arms react-flow's own pane-level `d3-drag` zoom/pan listener, which
    // throws in jsdom (`d3-drag`'s `nodrag.js` dereferences a null
    // `view.document`) -- the actual option-filtering LOGIC this renders
    // is covered directly, DOM-free, in `useToolNodeEditing.test.ts`.
    const { findByDisplayValue } = renderToolNode();
    await findByDisplayValue('do the thing');
    const comboboxes = document.body.querySelectorAll('[role="combobox"]');
    expect(comboboxes.length).toBe(4);
  });

  it('persists a task edit via updateYamlNode', async () => {
    const { findByDisplayValue, setYamlJsonObject } = renderToolNode();

    const taskField = await findByDisplayValue('do the thing');
    fireEvent.change(taskField, { target: { value: 'do a new thing' } });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    const nextNode = nextDoc.nodes?.find(node => node.id === 'tool-1');
    expect(nextNode?.task).toBe('do a new thing');
  });
});
