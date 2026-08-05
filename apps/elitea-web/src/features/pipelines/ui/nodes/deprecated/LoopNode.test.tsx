import { fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { renderDeprecatedNode } from './deprecatedNodeTestUtils';
import { LoopNode } from './LoopNode';

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
  { type: 'github', toolkit_name: 'my-github' },
  { type: 'application', name: 'sub-agent' },
];

function renderLoopNode(yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'loop-1', type: 'loop', toolkit_name: 'my-github', task: 'loop task' }] }) {
  const setYamlJsonObject = vi.fn();
  const contextValue: FlowEditorContextValue = {
    yamlJsonObject,
    setYamlJsonObject,
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
  };

  const result = renderDeprecatedNode(
    'loop-1',
    contextValue,
    <LoopNode
      id="loop-1"
      data={{}}
      type="loop"
      versionTools={versionTools}
    />,
  );

  return { ...result, setYamlJsonObject };
}

describe('LoopNode', () => {
  it('renders the task value', async () => {
    const { findByDisplayValue } = renderLoopNode();
    expect(await findByDisplayValue('loop task')).toBeInTheDocument();
  });

  it('persists a task edit via updateYamlNode', async () => {
    const { findByDisplayValue, setYamlJsonObject } = renderLoopNode();

    const taskField = await findByDisplayValue('loop task');
    fireEvent.change(taskField, { target: { value: 'new loop task' } });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    const nextNode = nextDoc.nodes?.find(node => node.id === 'loop-1');
    expect(nextNode?.task).toBe('new loop task');
  });
});
