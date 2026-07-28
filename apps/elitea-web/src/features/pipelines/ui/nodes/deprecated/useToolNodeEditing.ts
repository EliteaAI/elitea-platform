/**
 * `ToolNode.tsx`'s editing logic (baseline: `ToolNode.jsx:34-138`), split
 * into its own hook purely to keep `ToolNode.tsx` under the §3.5
 * `complexity` budget (12) — see `useConditionNodeEditing.ts`'s own doc
 * comment for the identical rationale (moving branching logic to a
 * separate function/file keeps its complexity from summing into the
 * component's own count). No behaviour change from the extraction.
 *
 * Real, disclosed gap (baseline: `useToolkitAvailableToolsQuery`,
 * `api/toolkits.js:515`) — no generated endpoint for dynamic MCP tool-name
 * discovery exists (confirmed against `shared/api/generated/toolkits/
 * toolkits.ts`'s full export list), the SAME gap the already-landed
 * `ui/select/LoopToolSelect.tsx`'s own doc comment documents. `functionOptions`
 * is therefore populated ONLY from an explicit `selectedToolkit.settings.
 * selected_tools` list.
 */
import { useCallback, useMemo } from 'react';
import type { ChangeEvent } from 'react';

import { batchUpdateYamlNode, getToolName, updateYamlNode } from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineDocument, YamlPipelineNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';

export interface ToolNodeState {
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly toolkit: string;
  readonly selectedToolkit: PipelineToolEntry | undefined;
  readonly taskValue: string;
  readonly toolValue: string;
}

function resolveToolkit(toolkitName: string | undefined, tool: string | undefined, id: string): string {
  return toolkitName ?? tool ?? id;
}

/**
 * `yamlNode`/`toolkit`/`selectedToolkit`/`taskValue`/`toolValue` derivation
 * (baseline: `ToolNode.jsx:22-33,138-140`), split out for the same
 * `complexity`-budget reason as `useToolNodeEditing` above.
 */
export function useToolNodeState(id: string, yamlJsonObject: YamlPipelineDocument | undefined, versionTools: readonly PipelineToolEntry[]): ToolNodeState {
  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find(node => node.id === id), [id, yamlJsonObject?.nodes]);
  const toolkit = useMemo(() => resolveToolkit(yamlNode?.toolkit_name, yamlNode?.tool, id), [id, yamlNode?.tool, yamlNode?.toolkit_name]);
  const selectedToolkit = useMemo(
    () => versionTools.find(tool => tool.toolkit_name === toolkit || tool.name === toolkit),
    [toolkit, versionTools],
  );

  return { yamlNode, toolkit, selectedToolkit, taskValue: yamlNode?.task ?? '', toolValue: yamlNode?.tool ?? '' };
}

interface ToolOption {
  readonly label: string;
  readonly value: string;
}

export interface UseToolNodeEditingArgs {
  readonly id: string;
  readonly selectedToolkit: PipelineToolEntry | undefined;
  readonly getToolkitNameFromSchema: (toolkit: PipelineToolEntry) => string;
  readonly getSelectedTools: (type: string) => readonly string[];
  readonly yamlJsonObject: YamlPipelineDocument | undefined;
  readonly setYamlJsonObject: ((next: YamlPipelineDocument) => void) | undefined;
}

export interface UseToolNodeEditingResult {
  readonly onSelectToolkit: (newToolkit: PipelineToolEntry | null) => void;
  readonly handleSetTask: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSetTool: (value: string) => void;
  readonly functionOptions: readonly ToolOption[];
}

function resolveToolkitName(newToolkit: PipelineToolEntry, getToolkitNameFromSchema: (tool: PipelineToolEntry) => string): string | undefined {
  if (newToolkit.type === 'application') return undefined;
  return newToolkit.toolkit_name ?? getToolkitNameFromSchema(newToolkit);
}

function resolveExplicitTool(newToolkit: PipelineToolEntry): string | undefined {
  return newToolkit.type === 'application' ? newToolkit.name : undefined;
}

function resolveFunctionOptions(
  selectedToolkit: PipelineToolEntry | undefined,
  getSelectedTools: (type: string) => readonly string[],
): readonly ToolOption[] {
  const explicitSelected: readonly string[] | undefined = selectedToolkit?.settings?.selected_tools;
  if (!Array.isArray(explicitSelected) || explicitSelected.length === 0) return [];

  const availableTools = getSelectedTools(selectedToolkit?.type ?? '');
  const enabledTools: readonly string[] =
    availableTools.length > 0 ? explicitSelected.filter((tool: string) => availableTools.includes(tool)) : explicitSelected;

  return enabledTools.map(item => ({ label: getToolName(item), value: getToolName(item) })).sort((a, b) => a.label.localeCompare(b.label));
}

export function useToolNodeEditing(args: UseToolNodeEditingArgs): UseToolNodeEditingResult {
  const { id, selectedToolkit, getToolkitNameFromSchema, getSelectedTools, yamlJsonObject, setYamlJsonObject } = args;

  const onSelectToolkit = useCallback(
    (newToolkit: PipelineToolEntry | null) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      if (!newToolkit) {
        batchUpdateYamlNode(id, { toolkit_name: undefined, tool: undefined }, yamlJsonObject, setYamlJsonObject);
        return;
      }
      batchUpdateYamlNode(
        id,
        { toolkit_name: resolveToolkitName(newToolkit, getToolkitNameFromSchema), tool: resolveExplicitTool(newToolkit) },
        yamlJsonObject,
        setYamlJsonObject,
      );
    },
    [getToolkitNameFromSchema, id, setYamlJsonObject, yamlJsonObject],
  );

  const handleSetTask = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      updateYamlNode(id, 'task', event.target.value, yamlJsonObject, setYamlJsonObject);
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const handleSetTool = useCallback(
    (value: string) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      batchUpdateYamlNode(id, { tool: value }, yamlJsonObject, setYamlJsonObject);
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const functionOptions = useMemo(() => resolveFunctionOptions(selectedToolkit, getSelectedTools), [getSelectedTools, selectedToolkit]);

  return { onSelectToolkit, handleSetTask, handleSetTool, functionOptions };
}
