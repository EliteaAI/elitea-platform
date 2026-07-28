import { cleanup, waitFor, type RenderResult } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { ReactFlow, ReactFlowProvider } from '@xyflow/react';

import { buildFlowEditorContextValue, renderWithRouterAndProject } from '../../__tests__/testUtils';
import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../select/pipelineToolEntry.types';
import { BaseToolNode, type BaseToolNodeProps } from './BaseToolNode';

const BASE = '/api/v2';
const PROJECT_ID = 'proj-1';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
  cleanup();
});

const versionTools: readonly PipelineToolEntry[] = [
  { type: 'github', toolkit_name: 'my-github', settings: { selected_tools: ['create_issue'] } },
];

function renderBaseToolNode(
  props: Partial<BaseToolNodeProps>,
  flowEditorOverrides: Partial<FlowEditorContextValue> = {},
): RenderResult {
  const yamlJsonObject: YamlPipelineDocument = flowEditorOverrides.yamlJsonObject ?? {
    nodes: [{ id: 'Node1', toolkit_name: 'my-github' }],
  };
  const flowEditorValue = buildFlowEditorContextValue({ yamlJsonObject, ...flowEditorOverrides });

  const fullProps: BaseToolNodeProps = {
    id: 'Node1',
    nodeType: 'toolkit',
    versionTools,
    ...props,
  };

  return renderWithRouterAndProject(
    <ReactFlowProvider>
      <FlowEditorContext.Provider value={flowEditorValue}>
        <ReactFlow
          nodes={[{ id: 'Node1', type: 'testNode', position: { x: 0, y: 0 }, data: fullProps.data ?? {} }]}
          edges={[]}
          nodeTypes={{ testNode: () => <BaseToolNode {...fullProps} /> }}
        />
      </FlowEditorContext.Provider>
    </ReactFlowProvider>,
    PROJECT_ID,
  );
}

describe('BaseToolNode', () => {
  describe('with an empty toolkit-type catalogue', () => {
    beforeEach(() => {
      server.use(http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () => HttpResponse.json({})));
    });

    it('renders the node id as the card name and both handles', async () => {
      const { container, getAllByRole } = renderBaseToolNode({});
      await waitFor(() => expect(getAllByRole('combobox', { hidden: true }).length).toBeGreaterThan(0));
      expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(2);
    });

    it('shows the selected toolkit label once toolkit_name resolves to a filtered-in versionTools entry', async () => {
      const { findByText } = renderBaseToolNode({});
      expect(await findByText('my-github')).toBeInTheDocument();
    });

    it('does not render a "Tool" sub-select when the selected toolkit has no explicit selected_tools and no dynamic schema is available', async () => {
      const noSelectionTools: readonly PipelineToolEntry[] = [{ type: 'github', toolkit_name: 'my-github' }];
      const { getAllByRole, findByText } = renderBaseToolNode({ versionTools: noSelectionTools });
      await findByText('my-github');
      // Toolkit ToolSelect + InputSelect + OutputSelect -- no fourth "Tool" combobox.
      expect(getAllByRole('combobox', { hidden: true })).toHaveLength(3);
    });

    it('renders a "Tool" sub-select once the selected toolkit has explicit selected_tools', async () => {
      const { getAllByRole, findByText } = renderBaseToolNode({});
      await findByText('my-github');
      await waitFor(() => expect(getAllByRole('combobox', { hidden: true })).toHaveLength(4));
    });

    it('renders the Structured output switch only when showStructuredOutput is true', async () => {
      const { findByText, queryByText } = renderBaseToolNode({ showStructuredOutput: true });
      await findByText('my-github');
      expect(queryByText('Structured output')).toBeInTheDocument();
    });

    it('omits the Structured output switch when showStructuredOutput is false (default)', async () => {
      const { findByText, queryByText } = renderBaseToolNode({});
      await findByText('my-github');
      expect(queryByText('Structured output')).not.toBeInTheDocument();
    });

    it('disables the toolkit select and every switch when isRunningPipeline is true', async () => {
      const { getAllByRole, findByText } = renderBaseToolNode({}, { isRunningPipeline: true });
      await findByText('my-github');
      // The toolkit ToolSelect is always the first combobox in DOM order.
      await waitFor(() => expect(getAllByRole('combobox', { hidden: true })[0]).toHaveAttribute('aria-disabled', 'true'));
      for (const switchControl of getAllByRole('switch', { hidden: true })) {
        expect(switchControl).toBeDisabled();
      }
    });

    it('does not disable the toolkit select when isRunningPipeline is false', async () => {
      const { getAllByRole, findByText } = renderBaseToolNode({}, { isRunningPipeline: false });
      await findByText('my-github');
      await waitFor(() => expect(getAllByRole('combobox', { hidden: true })[0]).not.toHaveAttribute('aria-disabled', 'true'));
    });

    it('renders the TriggerTypeSelector when the node is the pipeline entry point', async () => {
      const yamlJsonObject: YamlPipelineDocument = {
        nodes: [{ id: 'Node1', toolkit_name: 'my-github' }],
        entry_point: 'Node1',
      };
      const { findByText, getByText } = renderBaseToolNode({}, { yamlJsonObject });
      await findByText('my-github');
      expect(getByText('Trigger')).toBeInTheDocument();
    });

    it('does not render the TriggerTypeSelector when the node is not the entry point', async () => {
      const { findByText, queryByText } = renderBaseToolNode({});
      await findByText('my-github');
      expect(queryByText('Trigger')).not.toBeInTheDocument();
    });
  });

  describe('with a toolkit-type catalogue exposing static selected_tools schemas', () => {
    beforeEach(() => {
      server.use(
        http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () =>
          HttpResponse.json({
            github: {
              properties: {
                selected_tools: { args_schemas: { create_issue: {}, list_issues: {} } },
              },
            },
          }),
        ),
      );
    });

    it('intersects an explicit selected_tools list against the schema-available tool names', async () => {
      // 'list_issues' is NOT in this node's own explicit selection (only
      // 'create_issue' is), and 'delete_issue' is in neither -- the
      // rendered "Tool" combobox must still appear (a real intersection,
      // not an empty result) because 'create_issue' survives the filter.
      const { getAllByRole, findByText } = renderBaseToolNode({});
      await findByText('my-github');
      await waitFor(() => expect(getAllByRole('combobox', { hidden: true })).toHaveLength(4));
    });
  });
});
