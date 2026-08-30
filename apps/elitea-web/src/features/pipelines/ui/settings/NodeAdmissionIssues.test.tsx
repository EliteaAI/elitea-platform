import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { NodeAdmissionIssues } from './NodeAdmissionIssues';

/** A two-node document whose LLM node writes to a state key nobody declared. */
const UNDECLARED_OUTPUT: YamlPipelineDocument = {
  state: { input: 'str', messages: 'list' },
  entry_point: 'LLM_1',
  nodes: [{ id: 'LLM_1', type: 'llm', input: ['messages'], output: ['summary'], transition: 'END' }],
};

const ADMISSIBLE: YamlPipelineDocument = {
  state: { input: 'str', messages: 'list', summary: 'str' },
  entry_point: 'LLM_1',
  nodes: [{ id: 'LLM_1', type: 'llm', input: ['messages'], output: ['summary'], transition: 'END' }],
};

function renderForNode(yamlJsonObject: YamlPipelineDocument, nodeId: string) {
  return renderWithTheme(
    <FlowEditorContext.Provider value={buildFlowEditorContextValue({ yamlJsonObject })}>
      <NodeAdmissionIssues nodeId={nodeId} />
    </FlowEditorContext.Provider>,
  );
}

describe('NodeAdmissionIssues', () => {
  it('names the exact field and key the runtime would refuse', () => {
    const { getByTestId, getByText } = renderForNode(UNDECLARED_OUTPUT, 'LLM_1');

    expect(getByTestId('node-admission-issues')).toBeInTheDocument();
    // Not a generic "invalid node" — the field (`output[0]`) and the key
    // (`summary`) are both on screen, which is the whole point of mirroring
    // the compiler instead of forwarding its data-free error code.
    expect(getByText(/output\[0\]: "summary" is not declared/)).toBeInTheDocument();
  });

  it('renders nothing for an admissible node', () => {
    const { queryByTestId } = renderForNode(ADMISSIBLE, 'LLM_1');

    expect(queryByTestId('node-admission-issues')).not.toBeInTheDocument();
  });

  it('shows only its own node’s issues', () => {
    const twoBadNodes: YamlPipelineDocument = {
      state: { input: 'str', messages: 'list' },
      entry_point: 'LLM_1',
      nodes: [
        { id: 'LLM_1', type: 'llm', input: ['messages'], output: ['summary'], transition: 'END' },
        { id: 'LLM_2', type: 'llm', input: ['messages'], output: ['draft'], transition: 'END' },
      ],
    };
    const { getByTestId, queryByText } = renderForNode(twoBadNodes, 'LLM_1');

    expect(getByTestId('node-admission-issues')).toHaveTextContent('summary');
    expect(queryByText(/"draft"/)).not.toBeInTheDocument();
  });

  it('does not throw with no FlowEditorContext ancestor', () => {
    expect(() => renderWithTheme(<NodeAdmissionIssues nodeId="LLM_1" />)).not.toThrow();
  });
});
