/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/deprecated/LoopNode.jsx` (~165 lines) — unit A2g. NOT dead code:
 * still actively registered by the not-yet-built `FlowEditor.jsx` canvas
 * sub-unit (A2k) for pipelines whose stored YAML still uses the legacy
 * `loop` node type — see this unit's mission NOTES.
 *
 * DISCLOSED REDESIGNS — same set, same rationale, as `./ToolNode.tsx`'s own
 * doc comment (not repeated verbatim):
 *  1. `useFormikContext()` -> explicit `versionTools` prop.
 *  2. `useGetToolkitNameFromSchema()` -> locally-resolved `toolkitTypeSchemas`.
 *  3. `FlowEditorSelect.LoopToolSelect` -> `ui/select/LoopToolSelect.tsx`
 *     (unit A2h, landed) — same prop names the baseline passed
 *     (`yamlNode`/`disabled`/`onChangeToolkit`/`onChangeTool`), plus the
 *     `versionTools` prop that component's own deviation #1 requires.
 *  4. `FlowEditorSelect.InputSelect`/`OutputSelect` ->
 *     `ui/select/InputSelect.tsx`/`OutputSelect.tsx` (unit A2h, landed).
 *  5. `FlowEditorSettings.CommonInterruptSettings` ->
 *     `ui/settings/CommonInterruptSettings.tsx` (unit A2h, landed).
 *  6. `Input.StyledInputEnhancer` -> `shared/ui/StyledInputEnhancer`
 *     (`onChange` instead of the baseline's `onChange={handleSetTask}` —
 *     note the BASELINE `LoopNode.jsx` itself already used `onChange`, not
 *     `onInput`, unlike `ToolNode.jsx`/`LoopToolNode.jsx` — preserved as-is).
 *
 * `getSelectedToolkit`'s toolkit-type-based `application`-type routing
 * (`LoopNode.jsx:57-79`, deciding whether a picked value writes
 * `toolkit_name` or `tool`) is preserved verbatim, in the shared
 * `./toolkitWriteHelpers.ts` (also used by `LoopToolNode.tsx`) — this is
 * the one piece of real per-node logic `LoopToolSelect.tsx` does NOT itself
 * own (it only renders the picker; committing the picked value to the
 * right YAML field is this node's own `onChangeToolkit` callback, exactly
 * like the baseline).
 *
 * The editing/state-derivation logic lives in `./useLoopNodeEditing.ts`,
 * and the target/source handle pair in the shared
 * `./SimpleNodeHandles.tsx` — both split out purely to keep this file
 * under the §3.5 `complexity` budget (12).
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
import { NodeCard } from '../BaseNode/NodeCard';
import { SimpleNodeHandles } from './SimpleNodeHandles';
import { useFlowEditorNodeContext } from './useFlowEditorNodeContext';
import { useLoopNodeEditing } from './useLoopNodeEditing';

import { useEdges } from '@xyflow/react';

export interface LoopNodeProps {
  readonly id: string;
  readonly data?: { readonly isPerforming?: boolean } | undefined;
  readonly selected?: boolean | undefined;
  readonly type: string;
  /** See module doc comment, deviation 1. */
  readonly versionTools?: readonly PipelineToolEntry[] | undefined;
}

export const LoopNode = memo(function LoopNode(props: LoopNodeProps): ReactNode {
  const { id, data = {}, selected = false, type, versionTools = [] } = props;

  const edges = useEdges<FlowEdge>();
  const { yamlJsonObject, setYamlJsonObject, isRunningPipeline, disabled } = useFlowEditorNodeContext();
  const runningOrDisabled = Boolean(isRunningPipeline) || Boolean(disabled);
  const isPerforming = Boolean(data.isPerforming);

  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);

  const { yamlNode, taskValue, handleSetTask, onChangeToolkit, onChangeTool } = useLoopNodeEditing(
    id,
    yamlJsonObject,
    setYamlJsonObject,
    versionTools,
    getToolkitNameFromSchema,
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
      <StyledInputEnhancer
        disabled={runningOrDisabled}
        autoComplete="off"
        fullWidth
        name="task"
        label={t('pipelines.flowEditor.deprecated.loopNode.task', 'Task')}
        value={taskValue}
        onChange={handleSetTask}
        expand={{ minRows: 1, maxRows: 3 }}
        actions={{ showCopy: false, showExpand: false }}
      />
      <InputSelect
        id={id}
        label={t('pipelines.flowEditor.deprecated.loopNode.input', 'Input')}
        inputFieldName="input"
        disabled={runningOrDisabled}
      />
      <OutputSelect
        id={id}
        label={t('pipelines.flowEditor.deprecated.loopNode.output', 'Output')}
        outputFieldName="output"
        disabled={runningOrDisabled}
      />
      <CommonInterruptSettings
        id={id}
        type={PipelineNodeTypes.Loop}
        disabled={runningOrDisabled}
      />
    </NodeCard>
  );
});
