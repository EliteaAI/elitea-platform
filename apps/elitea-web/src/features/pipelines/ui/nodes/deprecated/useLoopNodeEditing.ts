/**
 * `LoopNode.tsx`'s state derivation + editing logic (baseline:
 * `LoopNode.jsx:22-97`), split into its own hook purely to keep
 * `LoopNode.tsx` under the §3.5 `complexity` budget (12) — see
 * `useConditionNodeEditing.ts`'s own doc comment for the identical
 * rationale. No behaviour change from the extraction.
 */
import { useCallback, useMemo } from 'react';
import type { ChangeEvent } from 'react';

import { batchUpdateYamlNode, updateYamlNode } from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineDocument, YamlPipelineNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { resolveToolkitFieldWrite } from './toolkitWriteHelpers';

export interface UseLoopNodeEditingResult {
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly taskValue: string;
  readonly handleSetTask: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeToolkit: (newValue: string | null) => void;
  readonly onChangeTool: (newValue: string) => void;
}

export function useLoopNodeEditing(
  id: string,
  yamlJsonObject: YamlPipelineDocument | undefined,
  setYamlJsonObject: ((next: YamlPipelineDocument) => void) | undefined,
  versionTools: readonly PipelineToolEntry[],
  getToolkitNameFromSchema: (tool: PipelineToolEntry) => string,
): UseLoopNodeEditingResult {
  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find(node => node.id === id), [id, yamlJsonObject?.nodes]);

  const handleSetTask = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!yamlJsonObject || !setYamlJsonObject) return;
      updateYamlNode(id, 'task', event.target.value, yamlJsonObject, setYamlJsonObject);
    },
    [id, setYamlJsonObject, yamlJsonObject],
  );

  const getSelectedToolkit = useCallback(
    (toolkitName: string | undefined) =>
      versionTools.find(tool => (tool.toolkit_name ? tool.toolkit_name === toolkitName : tool.name === toolkitName || getToolkitNameFromSchema(tool) === toolkitName)),
    [getToolkitNameFromSchema, versionTools],
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

  return { yamlNode, taskValue: yamlNode?.task ?? '', handleSetTask, onChangeToolkit, onChangeTool };
}
