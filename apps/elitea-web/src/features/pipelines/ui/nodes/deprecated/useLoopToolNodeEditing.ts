/**
 * `LoopToolNode.tsx`'s state derivation + editing logic (baseline:
 * `LoopToolNode.jsx:17-183`), split into its own hook purely to keep
 * `LoopToolNode.tsx` under the §3.5 `complexity` budget (12) — see
 * `useConditionNodeEditing.ts`'s own doc comment for the identical
 * rationale. No behaviour change from the extraction.
 *
 * `getDefaultInputMappingOfTool`'s `selectedToolkit`/`toolkitSchemas`
 * parameters are typed via a local, unexported interface in
 * `../../../lib/flow-editor/helpers/flowEditorInputMapping.helpers.ts`
 * (not importable by name). `toolkitDetails`/`toolkitTypeSchemas` are
 * passed with a documented `as never` cast at the call site, matching the
 * identical, already-landed precedent in `../BaseToolNode.tsx`
 * (`getDefaultInputMappingOfTool(toolkitTypes, undefined,
 * yamlNode?.input_mapping, newToolkit as never)`) for the exact same
 * friction (a `PipelineToolEntry`/`ToolkitTypeSchemaMap` value passed
 * where that file's own narrower, unexported structural type is expected —
 * genuinely compatible at every field this call site reads, verified by
 * reading `flowEditorInputMapping.helpers.ts` in full).
 */
import { useCallback, useMemo } from 'react';
import type { ChangeEvent } from 'react';

import { batchUpdateYamlNode, getDefaultInputMappingOfTool, updateYamlNode } from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlInputMappingEntry, YamlPipelineDocument, YamlPipelineNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import type { VariablesMappingEntry } from '../../settings/VariablesMapping';
import { resolveToolkitFieldWrite } from './toolkitWriteHelpers';

export interface UseLoopToolNodeEditingResult {
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly taskValue: string;
  readonly handleSetTask: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeToolkit: (newValue: string | null) => void;
  readonly onChangeTool: (newValue: string) => void;
  readonly onChangeLoopToolkit: (newValue: string | null) => void;
  readonly onChangeLoopTool: (newValue: string) => void;
  readonly onChangeMapping: (key: string, value: VariablesMappingEntry) => void;
}

export function useLoopToolNodeEditing(
  id: string,
  yamlJsonObject: YamlPipelineDocument | undefined,
  setYamlJsonObject: ((next: YamlPipelineDocument) => void) | undefined,
  versionTools: readonly PipelineToolEntry[],
  getToolkitNameFromSchema: (tool: PipelineToolEntry) => string,
  toolkitTypeSchemas: unknown,
): UseLoopToolNodeEditingResult {
  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find(node => node.id === id), [id, yamlJsonObject?.nodes]);

  const getSelectedToolkit = useCallback(
    (toolkitName: string | undefined) =>
      versionTools.find(tool => (tool.toolkit_name ? tool.toolkit_name === toolkitName : tool.name === toolkitName || getToolkitNameFromSchema(tool) === toolkitName)),
    [getToolkitNameFromSchema, versionTools],
  );

  const handleSetTask = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      updateYamlNode(id, 'task', event.target.value, yamlJsonObject, setYamlJsonObject);
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const onChangeToolkit = useCallback(
    (newValue: string | null) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      if (!newValue) {
        batchUpdateYamlNode(id, { toolkit_name: undefined, tool: undefined }, yamlJsonObject, setYamlJsonObject);
        return;
      }
      batchUpdateYamlNode(id, resolveToolkitFieldWrite(getSelectedToolkit(newValue), newValue), yamlJsonObject, setYamlJsonObject);
    },
    [getSelectedToolkit, id, setYamlJsonObject, yamlJsonObject],
  );

  const onChangeTool = useCallback(
    (newValue: string) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      updateYamlNode(id, 'tool', newValue, yamlJsonObject, setYamlJsonObject);
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const onChangeLoopToolkit = useCallback(
    (newValue: string | null) => {
      if (!yamlNode || !yamlJsonObject || !setYamlJsonObject) return;
      if (!newValue) {
        batchUpdateYamlNode(
          yamlNode.id,
          { loop_toolkit_name: undefined, loop_tool: undefined, variables_mapping: undefined },
          yamlJsonObject,
          setYamlJsonObject,
        );
        return;
      }
      const toolkitDetails = getSelectedToolkit(newValue);
      const { mapping } = getDefaultInputMappingOfTool(
        toolkitTypeSchemas as never,
        yamlNode.loop_tool,
        yamlNode.variables_mapping as Readonly<Record<string, YamlInputMappingEntry>> | undefined,
        toolkitDetails as never,
      );
      const fieldWrite = resolveToolkitFieldWrite(toolkitDetails, newValue);
      batchUpdateYamlNode(
        yamlNode.id,
        { variables_mapping: mapping, loop_toolkit_name: fieldWrite['toolkit_name'], loop_tool: fieldWrite['tool'] },
        yamlJsonObject,
        setYamlJsonObject,
      );
    },
    [getSelectedToolkit, setYamlJsonObject, toolkitTypeSchemas, yamlJsonObject, yamlNode],
  );

  const onChangeLoopTool = useCallback(
    (newValue: string) => {
      if (!yamlNode || !yamlJsonObject || !setYamlJsonObject) return;
      const toolkitDetails = getSelectedToolkit(yamlNode['loop_toolkit_name'] as string | undefined);
      const { mapping } = getDefaultInputMappingOfTool(
        toolkitTypeSchemas as never,
        newValue,
        yamlNode.variables_mapping as Readonly<Record<string, YamlInputMappingEntry>> | undefined,
        toolkitDetails as never,
      );
      batchUpdateYamlNode(yamlNode.id, { variables_mapping: mapping, loop_tool: newValue }, yamlJsonObject, setYamlJsonObject);
    },
    [getSelectedToolkit, setYamlJsonObject, toolkitTypeSchemas, yamlJsonObject, yamlNode],
  );

  const onChangeMapping = useCallback(
    (key: string, value: VariablesMappingEntry) => {
      if (!yamlNode || !yamlJsonObject || !setYamlJsonObject) return;
      const clonedVariablesMapping = { ...yamlNode.variables_mapping, [key]: value };
      updateYamlNode(yamlNode.id, 'variables_mapping', clonedVariablesMapping, yamlJsonObject, setYamlJsonObject);
    },
    [setYamlJsonObject, yamlJsonObject, yamlNode],
  );

  return {
    yamlNode,
    taskValue: yamlNode?.task ?? '',
    handleSetTask,
    onChangeToolkit,
    onChangeTool,
    onChangeLoopToolkit,
    onChangeLoopTool,
    onChangeMapping,
  };
}
