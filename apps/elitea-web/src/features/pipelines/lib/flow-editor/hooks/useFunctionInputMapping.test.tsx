import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterAndProject } from '../../../__tests__/testUtils';
import type { YamlPipelineDocument } from '../helpers/pipelineFlow.types';
import type { UseFunctionInputMappingArgs, UseFunctionInputMappingResult } from './useFunctionInputMapping';
import { useFunctionInputMapping } from './useFunctionInputMapping';

const BASE = '/api/v2';
const PROJECT_ID = 'proj-1';

/** Renders the hook via a real component tree (`useSelectedProjectId`/`useToolkitTypeSchemas` need router + query-client context) and hands every render's result out through `onResult`. */
function HookProbe({ onResult, ...args }: UseFunctionInputMappingArgs & { onResult: (result: UseFunctionInputMappingResult) => void }) {
  onResult(useFunctionInputMapping(args));
  return null;
}

describe('useFunctionInputMapping', () => {
  beforeEach(() => {
    configureGeneratedClient({ baseUrl: BASE });
    // Empty catalogue: no entry for the `custom` toolkit type -- reproduces the
    // disclosed "dynamic schema fetch missing" gap (file header, item 5) for a
    // non-MCP toolkit, since `properties` resolves to `{}` either way.
    server.use(http.get(`${BASE}/elitea_core/toolkits/prompt_lib/${PROJECT_ID}`, () => HttpResponse.json({})));
  });

  afterEach(() => {
    resetGeneratedClient();
  });

  it('preserves an already-saved input_mapping for a non-MCP toolkit when the dynamic schema fetch is unavailable, instead of wiping it to {}', async () => {
    const existingInputMapping = { existingField: { type: 'fixed', value: 'kept' } };
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'Node1', tool: 'my_tool', toolkit_name: 'custom_toolkit', input_mapping: existingInputMapping }],
    };
    const setYamlJsonObject = vi.fn();
    const versionTools = [{ type: 'custom', name: 'custom_toolkit', toolkit_name: 'custom_toolkit' }];

    let latest: UseFunctionInputMappingResult | undefined;
    renderWithRouterAndProject(
      <HookProbe
        id="Node1"
        yamlJsonObject={yamlJsonObject}
        setYamlJsonObject={setYamlJsonObject}
        versionTools={versionTools}
        onResult={result => {
          latest = result;
        }}
      />,
      PROJECT_ID,
    );

    await waitFor(() => expect(latest?.selectedToolkit).toBeDefined());
    await waitFor(() => expect(latest?.inputMappings).toEqual(existingInputMapping));

    // The hook must never have persisted an empty (wiped) input_mapping for this node.
    for (const call of setYamlJsonObject.mock.calls) {
      const persistedNode = (call[0] as YamlPipelineDocument).nodes?.find(node => node.id === 'Node1');
      if (persistedNode?.input_mapping) {
        expect(persistedNode.input_mapping).toEqual(existingInputMapping);
      }
    }
  });
});
