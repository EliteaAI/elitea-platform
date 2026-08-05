import { fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { renderDeprecatedNode } from './deprecatedNodeTestUtils';
import { LoopToolNode } from './LoopToolNode';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

const versionTools: readonly PipelineToolEntry[] = [{ type: 'github', toolkit_name: 'my-github' }];

function renderLoopToolNode(
  yamlJsonObject: YamlPipelineDocument = {
    nodes: [
      {
        id: 'loop-tool-1',
        type: 'loop_from_tool',
        toolkit_name: 'my-github',
        task: 'loop tool task',
        variables_mapping: { output: { type: 'fixed', value: 'hello' } },
      },
    ],
  },
) {
  const setYamlJsonObject = vi.fn();
  const contextValue: FlowEditorContextValue = {
    yamlJsonObject,
    setYamlJsonObject,
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
  };

  const result = renderDeprecatedNode(
    'loop-tool-1',
    contextValue,
    <LoopToolNode
      id="loop-tool-1"
      data={{}}
      type="loop_from_tool"
      versionTools={versionTools}
    />,
  );

  return { ...result, setYamlJsonObject };
}

describe('LoopToolNode', () => {
  it('renders the task value', async () => {
    const { findByDisplayValue } = renderLoopToolNode();
    expect(await findByDisplayValue('loop tool task')).toBeInTheDocument();
  });

  it('renders the variables mapping accordion with the stored entry count', async () => {
    const { findByText } = renderLoopToolNode();
    expect(await findByText('Variables mapping(1)')).toBeInTheDocument();
  });

  it('persists a task edit via updateYamlNode', async () => {
    const { findByDisplayValue, setYamlJsonObject } = renderLoopToolNode();

    const taskField = await findByDisplayValue('loop tool task');
    fireEvent.change(taskField, { target: { value: 'new loop tool task' } });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    const nextNode = nextDoc.nodes?.find(node => node.id === 'loop-tool-1');
    expect(nextNode?.task).toBe('new loop tool task');
  });
});
