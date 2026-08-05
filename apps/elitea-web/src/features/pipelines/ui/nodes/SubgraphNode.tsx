/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/SubgraphNode.jsx` (111 lines) — unit A2f. `NodeCard`/`CustomHandle`
 * (A2e) and `ToolSelect`/`CommonInterruptSettings` (A2h) landed in this
 * shared worktree while this sub-unit was in progress — imported from their
 * real, verified paths/prop shapes.
 *
 * The baseline calls bare `useGetToolkitNameFromSchema()` (ambient Redux
 * `schemaOfTools`, `SubgraphNode.jsx:35`) purely to derive a display name
 * for a non-Application-typed selected toolkit. This file resolves its own
 * `toolkitTypes` the same way `./AgentNode.tsx`'s `useFunctionInputMapping`
 * internally does (`useSelectedProjectId` + `useToolkitTypeSchemas`, both
 * already-landed A2d hooks this file does NOT otherwise need
 * `useFunctionInputMapping` for — `SubgraphNode` has no `input_mapping` UI
 * at all in the baseline, only the toolkit picker + interrupt settings).
 *
 * `versionTools` (typed `PipelineToolEntry[]`, `ToolSelect.tsx`'s own
 * shared type, A2h) is the same "ambient Formik -> explicit prop" redesign
 * `./AgentNode.tsx`'s module doc comment covers in full.
 */
import type { ReactNode } from 'react';
import { memo, useCallback, useContext, useMemo } from 'react';

import { useEdges, type NodeProps } from '@xyflow/react';

import { ToolTypes } from '@/entities/toolkit';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { batchUpdateYamlNode } from '../../lib/flow-editor/helpers/flowEditor.helpers';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import { useGetToolkitNameFromSchema } from '../../lib/flow-editor/hooks/useGetToolkitNameFromSchema';
import { useSelectedProjectId } from '../../lib/flow-editor/hooks/useSelectedProjectId';
import { useToolkitTypeSchemas } from '../../lib/flow-editor/hooks/useToolkitTypeSchemas';
import type { FlowNode } from '../../lib/flow-editor/reactFlowTypes';
import { CommonInterruptSettings } from '../settings/CommonInterruptSettings';
import { ToolSelect } from '../select/ToolSelect';
import type { PipelineToolEntry } from '../select/pipelineToolEntry.types';
import { CustomHandle } from './CustomHandle';
import { NodeCard } from './BaseNode/NodeCard';

const toolkitFilter = (tool: PipelineToolEntry): boolean =>
  tool.type === ToolTypes.application.value && tool.agent_type === FlowEditorConstants.PipelineNodeTypes.Pipeline;

export interface SubgraphNodeProps extends NodeProps<FlowNode> {
  readonly versionTools?: readonly PipelineToolEntry[] | undefined;
}

export const SubgraphNode = memo(function SubgraphNode(props: SubgraphNodeProps): ReactNode {
  const { id, data, selected, versionTools } = props;
  const edges = useEdges();
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject ?? {};
  const setYamlJsonObject = context?.setYamlJsonObject;
  const isRunningPipeline = context?.isRunningPipeline;
  const disabled = context?.disabled;

  const yamlNode = useMemo(() => yamlJsonObject.nodes?.find(node => node.id === id), [id, yamlJsonObject.nodes]);
  const toolkit = useMemo(() => yamlNode?.toolkit_name ?? yamlNode?.tool ?? id, [id, yamlNode?.tool, yamlNode?.toolkit_name]);
  const isSourceConnectable = useMemo(
    () => !edges.find(edge => edge.source === id && edge.target !== FlowEditorConstants.PipelineNodeTypes.End),
    [edges, id],
  );

  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);

  const onSelectToolkit = useCallback(
    (newToolkit: PipelineToolEntry | null) => {
      if (!setYamlJsonObject) return;
      if (!newToolkit) {
        batchUpdateYamlNode(id, { toolkit_name: undefined, tool: undefined }, yamlJsonObject, setYamlJsonObject);
        return;
      }
      batchUpdateYamlNode(
        id,
        {
          toolkit_name:
            newToolkit.type !== ToolTypes.application.value
              ? (newToolkit.toolkit_name ?? getToolkitNameFromSchema(newToolkit))
              : undefined,
          tool: newToolkit.type === ToolTypes.application.value ? newToolkit.name : undefined,
        },
        yamlJsonObject,
        setYamlJsonObject,
      );
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getToolkitNameFromSchema, id, setYamlJsonObject, yamlJsonObject],
  );

  return (
    <NodeCard
      name={id}
      isEntrypoint={yamlJsonObject.entry_point === id}
      selected={selected}
      type={FlowEditorConstants.PipelineNodeTypes.Pipeline}
      isPerforming={Boolean(data?.['isPerforming'])}
      id={id}
      handles={() => (
        <>
          <CustomHandle
            type="target"
            id="target"
            isConnectable={!isRunningPipeline && !disabled}
            isRunningPipeline={Boolean(isRunningPipeline)}
            isPerforming={Boolean(data?.['isPerforming'])}
          />
          <CustomHandle
            type="source"
            id="source"
            isConnectable={isSourceConnectable && !isRunningPipeline && !disabled}
            isRunningPipeline={Boolean(isRunningPipeline)}
            isPerforming={Boolean(data?.['isPerforming'])}
          />
        </>
      )}
    >
      <ToolSelect
        onSelectTool={onSelectToolkit}
        selectedToolkit={toolkit}
        disabled={Boolean(isRunningPipeline || disabled)}
        filterTypes={toolkitFilter}
        versionTools={versionTools ?? []}
      />
      <CommonInterruptSettings
        id={id}
        type={FlowEditorConstants.PipelineNodeTypes.Pipeline}
        disabled={Boolean(isRunningPipeline || disabled)}
        showStructuredOutput={false}
      />
    </NodeCard>
  );
});
