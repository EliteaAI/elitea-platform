import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { YamlPipelineDocument } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { useToolNodeEditing, useToolNodeState } from './useToolNodeEditing';

describe('useToolNodeState', () => {
  it('resolves toolkit from the yaml node toolkit_name, falling back to tool then id', () => {
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'tool-1', toolkit_name: 'my-github', task: 'do it', tool: 'create_issue' }],
    };
    const { result } = renderHook(() => useToolNodeState('tool-1', yamlJsonObject, []));
    expect(result.current.toolkit).toBe('my-github');
    expect(result.current.taskValue).toBe('do it');
    expect(result.current.toolValue).toBe('create_issue');
  });

  it('finds the matching versionTools entry by toolkit_name', () => {
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'tool-1', toolkit_name: 'my-github' }] };
    const versionTools: readonly PipelineToolEntry[] = [{ type: 'github', toolkit_name: 'my-github' }];
    const { result } = renderHook(() => useToolNodeState('tool-1', yamlJsonObject, versionTools));
    expect(result.current.selectedToolkit).toEqual(versionTools[0]);
  });
});

describe('useToolNodeEditing functionOptions', () => {
  it('is empty when the selected toolkit has no explicit selected_tools', () => {
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: { type: 'github', toolkit_name: 'my-github' },
        getToolkitNameFromSchema: () => '',
        getSelectedTools: () => [],
        yamlJsonObject: { nodes: [] },
        setYamlJsonObject: vi.fn(),
      }),
    );
    expect(result.current.functionOptions).toEqual([]);
  });

  it('lists every explicit selected_tools entry, alphabetically, when the toolkit type has no schema-derived restriction', () => {
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: { type: 'github', toolkit_name: 'my-github', settings: { selected_tools: ['list_issues', 'create_issue'] } },
        getToolkitNameFromSchema: () => '',
        getSelectedTools: () => [],
        yamlJsonObject: { nodes: [] },
        setYamlJsonObject: vi.fn(),
      }),
    );
    expect(result.current.functionOptions).toEqual([
      { label: 'create_issue', value: 'create_issue' },
      { label: 'list_issues', value: 'list_issues' },
    ]);
  });

  it('filters explicit selected_tools down to the schema-available set when one is known', () => {
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: { type: 'github', toolkit_name: 'my-github', settings: { selected_tools: ['create_issue', 'delete_repo'] } },
        getToolkitNameFromSchema: () => '',
        getSelectedTools: () => ['create_issue'],
        yamlJsonObject: { nodes: [] },
        setYamlJsonObject: vi.fn(),
      }),
    );
    expect(result.current.functionOptions).toEqual([{ label: 'create_issue', value: 'create_issue' }]);
  });
});

describe('useToolNodeEditing onSelectToolkit', () => {
  it('writes toolkit_name for a non-application toolkit and clears tool', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'tool-1' }] };
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: undefined,
        getToolkitNameFromSchema: () => 'derived-name',
        getSelectedTools: () => [],
        yamlJsonObject,
        setYamlJsonObject,
      }),
    );

    result.current.onSelectToolkit({ type: 'github', toolkit_name: 'my-github' });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]).toMatchObject({ toolkit_name: 'my-github', tool: undefined });
  });

  it('writes tool (not toolkit_name) for an application-type association', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'tool-1' }] };
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: undefined,
        getToolkitNameFromSchema: () => '',
        getSelectedTools: () => [],
        yamlJsonObject,
        setYamlJsonObject,
      }),
    );

    result.current.onSelectToolkit({ type: 'application', name: 'sub-agent' });

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]).toMatchObject({ toolkit_name: undefined, tool: 'sub-agent' });
  });

  it('clears both fields when passed null', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'tool-1', toolkit_name: 'my-github' }] };
    const { result } = renderHook(() =>
      useToolNodeEditing({
        id: 'tool-1',
        selectedToolkit: undefined,
        getToolkitNameFromSchema: () => '',
        getSelectedTools: () => [],
        yamlJsonObject,
        setYamlJsonObject,
      }),
    );

    result.current.onSelectToolkit(null);

    const [nextDoc] = setYamlJsonObject.mock.calls[0] as [YamlPipelineDocument];
    expect(nextDoc.nodes?.[0]).toMatchObject({ toolkit_name: undefined, tool: undefined });
  });
});
