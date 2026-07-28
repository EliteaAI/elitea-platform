import type { ReactElement, ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { renderHook, type RenderHookResult } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { ReactFlow, ReactFlowProvider, type Edge } from '@xyflow/react';

import { createTestQueryClient } from '../../__tests__/testUtils';
import { FlowEditorContext, NodeCardContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { LLMNodeHandles, useLLMNodeModel, type UseLLMNodeModelArgs } from './LLMNode.parts';

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
  server.use(http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () => HttpResponse.json({})));
});

afterEach(() => {
  resetGeneratedClient();
});

/**
 * `useLLMNodeModel` reads `useSelectedProjectId()` (needs a real
 * `<RouterProvider>` route-context ancestor, same as
 * `../../__tests__/testUtils`'s own `renderWithRouterAndProject`), several
 * `@xyflow/react` hooks (needs `<ReactFlowProvider>`, optionally seeded with
 * `edges`), and `useToolkitTypeSchemas` (a real generated-client query,
 * needs `QueryClientProvider` + MSW). No existing helper combines all three
 * for a `renderHook` (rather than a full `render`) call -- built locally,
 * purely for this hook's own test file.
 */
function renderUseLLMNodeModel(
  args: UseLLMNodeModelArgs,
  contextValue: FlowEditorContextValue,
  edges: Edge[] = [],
): RenderHookResult<ReturnType<typeof useLLMNodeModel>, unknown> {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    function RootComponent(): ReactNode {
      return (
        <QueryClientProvider client={queryClient}>
          <ReactFlowProvider initialEdges={edges}>
            <FlowEditorContext.Provider value={contextValue}>{children}</FlowEditorContext.Provider>
          </ReactFlowProvider>
        </QueryClientProvider>
      );
    }
    const rootRoute = createRootRoute({ component: RootComponent });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { auth: { getSelectedProjectId: () => PROJECT_ID } },
    });
    return <RouterProvider router={router} />;
  }

  return renderHook(() => useLLMNodeModel(args), { wrapper: Wrapper });
}

describe('useLLMNodeModel', () => {
  it('falls back to a stable empty FlowEditorContext with no ancestor Provider', async () => {
    const queryClient = createTestQueryClient();
    function Wrapper({ children }: { children: ReactNode }): ReactElement {
      function RootComponent(): ReactNode {
        return (
          <QueryClientProvider client={queryClient}>
            <ReactFlowProvider>{children}</ReactFlowProvider>
          </QueryClientProvider>
        );
      }
      const rootRoute = createRootRoute({ component: RootComponent });
      const router = createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({ initialEntries: ['/'] }),
        context: { auth: { getSelectedProjectId: () => PROJECT_ID } },
      });
      return <RouterProvider router={router} />;
    }

    const { result } = renderHook(() => useLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }), { wrapper: Wrapper });

    await vi.waitFor(() => {
      expect(result.current.isRunningPipeline).toBe(false);
      expect(result.current.disabled).toBe(false);
      expect(result.current.isEntrypoint).toBe(false);
    });
  });

  it('resolves isEntrypoint/isFieldsDisabled from FlowEditorContext', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }], entry_point: 'Node1' },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
      isRunningPipeline: true,
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);

    await vi.waitFor(() => {
      expect(result.current.isEntrypoint).toBe(true);
      expect(result.current.isFieldsDisabled).toBe(true);
    });
  });

  it('defaults inputMappings to system/task/chat_history and initialises the yaml node input_mapping', async () => {
    const setYamlJsonObject = vi.fn();
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);

    await vi.waitFor(() => {
      expect(Object.keys(result.current.inputMappings)).toEqual(['system', 'task', 'chat_history']);
    });
    expect(setYamlJsonObject).toHaveBeenCalled();
  });

  it('handleSimpleLLMChange defaults a missing type to "fixed" and forwards the value', async () => {
    const setYamlJsonObject = vi.fn<(next: YamlPipelineDocument) => void>();
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: {
        nodes: [
          {
            id: 'Node1',
            input_mapping: { system: { type: 'fixed', value: '' }, task: { type: 'fixed', value: '' }, chat_history: { type: 'fixed', value: [] } },
          },
        ],
      },
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);
    await vi.waitFor(() => expect(result.current.inputMappings.system).toBeDefined());

    setYamlJsonObject.mockClear();
    result.current.handleSimpleLLMChange('task', { value: 'no type here' });

    const nextDoc = setYamlJsonObject.mock.calls[0]?.[0];
    const updatedNode = nextDoc?.nodes?.find(node => node.id === 'Node1');
    expect(updatedNode?.['input_mapping']).toEqual(expect.objectContaining({ task: { type: 'fixed', value: 'no type here' } }));
  });

  it('handleSimpleLLMChange forwards an explicit type unchanged', async () => {
    const setYamlJsonObject = vi.fn<(next: YamlPipelineDocument) => void>();
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject,
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);
    await vi.waitFor(() => expect(result.current.inputMappings.system).toBeDefined());

    setYamlJsonObject.mockClear();
    result.current.handleSimpleLLMChange('system', { type: 'fstring', value: '{{x}}' });

    const nextDoc = setYamlJsonObject.mock.calls[0]?.[0];
    const updatedNode = nextDoc?.nodes?.find(node => node.id === 'Node1');
    expect(updatedNode?.['input_mapping']).toEqual(expect.objectContaining({ system: { type: 'fstring', value: '{{x}}' } }));
  });

  it('isSourceConnectable is false once an outgoing edge to a non-END target already exists', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }, { id: 'Other' }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel(
      { id: 'Node1', versionTools: undefined, llmSettings: null },
      contextValue,
      [{ id: 'e1', source: 'Node1', target: 'Other' }],
    );

    await vi.waitFor(() => expect(result.current.isSourceConnectable).toBe(false));
  });

  it('isSourceConnectable stays true when the only outgoing edge targets END', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel(
      { id: 'Node1', versionTools: undefined, llmSettings: null },
      contextValue,
      [{ id: 'e1', source: 'Node1', target: 'END' }],
    );

    await vi.waitFor(() => expect(result.current.isSourceConnectable).toBe(true));
  });

  it('toolkitToolRows resolves the tool list per toolkit named in tool_names, from versionTools.tools (unresolved schema -> availableTools empty -> unfiltered)', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1', tool_names: { github: [] } }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const versionTools = [{ type: 'github', toolkit_name: 'github', tools: ['create_issue', 'list_issues'] }];
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools, llmSettings: null }, contextValue);

    await vi.waitFor(() => {
      expect(result.current.toolkitToolRows).toEqual([{ toolkitName: 'github', tools: ['create_issue', 'list_issues'] }]);
    });
  });

  it('toolkitToolRows resolves the toolkit name via getToolkitNameFromSchema when the versionTools entry has no toolkit_name (falls back to tool.name)', async () => {
    const contextValue: FlowEditorContextValue = {
      // `genToolkitNameFallback` cleans `tool.name` when no schema `toolkit_name` property is found -- 'JiraTool' has no special characters, so it survives unchanged.
      yamlJsonObject: { nodes: [{ id: 'Node1', tool_names: { JiraTool: [] } }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const versionTools = [{ type: 'jira', name: 'JiraTool', tools: ['issue_create'] }];
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools, llmSettings: null }, contextValue);

    await vi.waitFor(() => {
      expect(result.current.toolkitToolRows).toEqual([{ toolkitName: 'JiraTool', tools: ['issue_create'] }]);
    });
  });

  it('toolkitToolRows falls back to settings.selected_tools (mixed string/object entries) when the toolkit has no tools[], and filters by the resolved schema tool list', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () =>
        HttpResponse.json({ jira: { properties: { selected_tools: { args_schemas: { issue_create: {}, other_tool: {} } } } } }),
      ),
    );
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1', tool_names: { jira: [] } }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const versionTools = [
      { type: 'jira', toolkit_name: 'jira', settings: { selected_tools: ['issue_create', { name: 'issue_delete' }] } },
    ];
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools, llmSettings: null }, contextValue);

    // `allTools` = ['issue_create', 'issue_delete'] (string entry + object-entry `.name`); `availableTools` (from the
    // schema's `selected_tools.args_schemas`) = ['issue_create', 'other_tool'] -- only their intersection survives.
    await vi.waitFor(() => {
      expect(result.current.toolkitToolRows).toEqual([{ toolkitName: 'jira', tools: ['issue_create'] }]);
    });
  });

  it('toolkitToolRows is empty when the yaml node has no tool_names', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);

    await vi.waitFor(() => {
      expect(Object.keys(result.current.inputMappings).length).toBeGreaterThan(0);
    });
    expect(result.current.toolkitToolRows).toEqual([]);
  });

  it('resolvedLlmSettings is null when llmSettings is null', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: null }, contextValue);

    await vi.waitFor(() => expect(result.current.resolvedLlmSettings).toBeNull());
  });

  it('resolvedLlmSettings passes a real settings object through unchanged', async () => {
    const contextValue: FlowEditorContextValue = {
      yamlJsonObject: { nodes: [{ id: 'Node1' }] },
      setYamlJsonObject: vi.fn(),
      setFlowNodes: vi.fn(),
      setFlowEdges: vi.fn(),
    };
    const settings = { model_name: 'gpt-4', temperature: 0.7, max_tokens: 1000 };
    const { result } = renderUseLLMNodeModel({ id: 'Node1', versionTools: undefined, llmSettings: settings }, contextValue);

    await vi.waitFor(() => expect(result.current.resolvedLlmSettings).toEqual(settings));
  });
});

describe('LLMNodeHandles', () => {
  it('renders a target and a source handle', () => {
    const { container } = renderWithTheme(
      <ReactFlowProvider>
        <ReactFlow
          nodes={[{ id: 'node-1', type: 'testNode', position: { x: 0, y: 0 }, data: {} }]}
          edges={[]}
          nodeTypes={{
            testNode: () => (
              <NodeCardContext.Provider value={{ isExpanded: true }}>
                <LLMNodeHandles
                  isRunningPipeline={false}
                  disabled={false}
                  isSourceConnectable
                  isPerforming={false}
                />
              </NodeCardContext.Provider>
            ),
          }}
        />
      </ReactFlowProvider>,
    );

    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(2);
  });
});
