/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/deprecated/LoopToolNode.jsx` (~275 lines) — unit A2g. NOT dead
 * code: still actively registered by the not-yet-built `FlowEditor.jsx`
 * canvas sub-unit (A2k) for pipelines whose stored YAML still uses the
 * legacy `loop_from_tool` node type — see this unit's mission NOTES.
 *
 * DISCLOSED REDESIGNS — the same set as `./LoopNode.tsx`'s own doc
 * comment (`useFormikContext()` -> `versionTools` prop,
 * `useGetToolkitNameFromSchema()` -> locally-resolved `toolkitTypeSchemas`,
 * `FlowEditorSelect.LoopToolSelect`/`InputSelect`/`OutputSelect` ->
 * `ui/select/*.tsx`, `FlowEditorSettings.CommonInterruptSettings` ->
 * `ui/settings/CommonInterruptSettings.tsx`, `Input.StyledInputEnhancer`
 * -> `shared/ui/StyledInputEnhancer`, the shared `application`-type
 * toolkit/tool field-routing rule -> `./toolkitWriteHelpers.ts`), plus:
 *
 *  1. `useGetCurrentToolkitSchemas` (baseline: `features/toolkits/lib/
 *     hooks`) -- this mission's own preamble flags this as a confirmed-
 *     NOT-promoted, cross-feature hook (`no-sideways-features` forbids
 *     `features/pipelines` reaching into `features/toolkits` regardless).
 *     Replaced with the already-landed intra-slice
 *     `lib/flow-editor/hooks/useToolkitTypeSchemas.ts` (unit A2d) — the
 *     SAME replacement the already-landed `ui/select/LoopToolSelect.tsx`/
 *     `ToolSelect.tsx` (unit A2h) independently made for their own,
 *     near-identical schema need.
 *  2. `FlowEditorSettings.VariablesMapping` -> `ui/settings/
 *     VariablesMapping.tsx` (unit A2i, landed). Its `onDeleteMapping` prop
 *     (baseline) is DROPPED — that component's own doc comment: "no delete
 *     affordance exists anywhere in this file's JSX; grep-confirmed dead in
 *     the baseline", so this node's own `onDeleteMapping` handler
 *     (baseline: `FlowEditorHelpers.removeYamlNodeVariablesMapping`) is
 *     correspondingly not built here either — there is nothing left for it
 *     to be wired to.
 *
 * The editing/state-derivation logic lives in
 * `./useLoopToolNodeEditing.ts`, and the target/source handle pair in the
 * shared `./SimpleNodeHandles.tsx` — both split out purely to keep this
 * file under the §3.5 `complexity` budget (12).
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';
import { t } from '@/shared/i18n';

import { PipelineNodeTypes } from '../../../lib/flow-editor/constants/flowEditor.constants';
import { useGetToolkitNameFromSchema } from '../../../lib/flow-editor/hooks/useGetToolkitNameFromSchema';
import { useSelectedProjectId } from '../../../lib/flow-editor/hooks/useSelectedProjectId';
import { useToolkitTypeSchemas } from '../../../lib/flow-editor/hooks/useToolkitTypeSchemas';
import type { FlowEdge } from '../../../lib/flow-editor/reactFlowTypes';
import { CommonInterruptSettings } from '../../settings/CommonInterruptSettings';
import { InputSelect } from '../../select/InputSelect';
import { LoopToolSelect } from '../../select/LoopToolSelect';
import { OutputSelect } from '../../select/OutputSelect';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { VariablesMapping, type VariablesMappingEntry } from '../../settings/VariablesMapping';
import { NodeCard } from '../BaseNode/NodeCard';
import { SimpleNodeHandles } from './SimpleNodeHandles';
import { useFlowEditorNodeContext } from './useFlowEditorNodeContext';
import { useLoopToolNodeEditing } from './useLoopToolNodeEditing';

import { useEdges } from '@xyflow/react';

export interface LoopToolNodeProps {
  readonly id: string;
  readonly data?: { readonly isPerforming?: boolean } | undefined;
  readonly selected?: boolean | undefined;
  readonly type: string;
  /** See module doc comment, deviation (shared with `LoopNode.tsx`) 1. */
  readonly versionTools?: readonly PipelineToolEntry[] | undefined;
}

export const LoopToolNode = memo(function LoopToolNode(props: LoopToolNodeProps): ReactNode {
  const { id, data = {}, selected = false, type, versionTools = [] } = props;

  const edges = useEdges<FlowEdge>();
  const { yamlJsonObject, setYamlJsonObject, isRunningPipeline, disabled } = useFlowEditorNodeContext();
  const runningOrDisabled = Boolean(isRunningPipeline) || Boolean(disabled);
  const isPerforming = Boolean(data.isPerforming);

  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);

  const { yamlNode, taskValue, handleSetTask, onChangeToolkit, onChangeTool, onChangeLoopToolkit, onChangeLoopTool, onChangeMapping } = useLoopToolNodeEditing(
    id,
    yamlJsonObject,
    setYamlJsonObject,
    versionTools,
    getToolkitNameFromSchema,
    toolkitTypeSchemas,
  );

  return (
    <NodeCard
      name={id}
      isEntrypoint={yamlJsonObject?.entry_point === id}
      selected={selected}
      type={type}
      isPerforming={isPerforming}
      id={id}
      handles={() => (
        <SimpleNodeHandles
          id={id}
          edges={edges}
          isRunningPipeline={Boolean(isRunningPipeline)}
          disabled={Boolean(disabled)}
          isPerforming={isPerforming}
        />
      )}
    >
      <LoopToolSelect
        {...(yamlNode !== undefined ? { yamlNode } : {})}
        disabled={runningOrDisabled}
        onChangeToolkit={onChangeToolkit}
        onChangeTool={onChangeTool}
        versionTools={versionTools}
      />
      <LoopToolSelect
        {...(yamlNode !== undefined ? { yamlNode } : {})}
        disabled={runningOrDisabled}
        onChangeToolkit={onChangeLoopToolkit}
        onChangeTool={onChangeLoopTool}
        label={t('pipelines.flowEditor.deprecated.loopToolNode.loopToolkit', 'Loop toolkit')}
        toolkitField="loop_toolkit_name"
        toolField="loop_tool"
        versionTools={versionTools}
      />
      <VariablesMapping
        variables_mapping={(yamlNode?.variables_mapping as Record<string, VariablesMappingEntry> | undefined) ?? {}}
        onChangeMapping={onChangeMapping}
        disabled={runningOrDisabled}
      />
      <StyledInputEnhancer
        disabled={runningOrDisabled}
        autoComplete="off"
        fullWidth
        name="task"
        label={t('pipelines.flowEditor.deprecated.loopToolNode.task', 'Task')}
        value={taskValue}
        onChange={handleSetTask}
        expand={{ minRows: 1, maxRows: 3 }}
        actions={{ showCopy: false, showExpand: false }}
      />
      <InputSelect
        id={id}
        label={t('pipelines.flowEditor.deprecated.loopToolNode.input', 'Input')}
        inputFieldName="input"
        disabled={runningOrDisabled}
      />
      <OutputSelect
        id={id}
        label={t('pipelines.flowEditor.deprecated.loopToolNode.output', 'Output')}
        outputFieldName="output"
        disabled={runningOrDisabled}
      />
      <CommonInterruptSettings
        id={id}
        type={PipelineNodeTypes.LoopFromTool}
        disabled={runningOrDisabled}
      />
    </NodeCard>
  );
});
