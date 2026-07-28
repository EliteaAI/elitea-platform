/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/DefaultNode.jsx` (220 lines, unit A2e). Renders for any node type
 * without a dedicated component (baseline: the flow editor's fallback node
 * type, `PipelineNodeTypes.Default`).
 *
 * DISCLOSED REDESIGN: `useFunctionInputMapping`/`toolsWithNames` take an
 * explicit `versionTools` prop instead of the baseline's ambient
 * `useFormikContext().values.version_details.tools` read -- same rationale
 * as `BaseToolNode.tsx`'s own header (that hook's own header covers the
 * no-Formik rationale in full).
 *
 * `mappingInfo`/`input_mapping`/`onChangeMapping` are cast (`as never`)
 * where passed to the landed `InputMapping` (unit A2i) -- same "two
 * independently-authored TS types don't structurally unify, runtime shapes
 * match" situation `CodeNode.tsx`'s own header documents in full.
 *
 * The baseline exports a custom `arePropsEqual` comparator wrapping its own
 * `memo()` call (`DefaultNode.jsx:205-217`, "prevent re-renders during rapid
 * drag operations") -- preserved verbatim below.
 */
import type { ReactNode } from 'react';
import { memo, useCallback, useContext, useMemo } from 'react';

import { SingleSelect } from '@/shared/ui/SingleSelect';
import { ToolTypes } from '@/entities/toolkit';
import { t } from '@/shared/i18n';

import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import { batchUpdateYamlNode, getDefaultInputMappingOfTool, getToolName } from '../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineNode } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { useFunctionInputMapping } from '../../lib/flow-editor/hooks/useFunctionInputMapping';
import { useGetToolkitNameFromSchema } from '../../lib/flow-editor/hooks/useGetToolkitNameFromSchema';
import { useSelectedProjectId } from '../../lib/flow-editor/hooks/useSelectedProjectId';
import { useToolkitTypeSchemas } from '../../lib/flow-editor/hooks/useToolkitTypeSchemas';
import { InputSelect } from '../select/InputSelect';
import { OutputSelect } from '../select/OutputSelect';
import { ToolSelect } from '../select/ToolSelect';
import type { PipelineToolEntry } from '../select/pipelineToolEntry.types';
import { CommonInterruptSettings } from '../settings/CommonInterruptSettings';
import { CustomNodeInput } from '../settings/CustomNodeInput';
import { InputMapping } from '../settings/InputMappings/InputMapping';
import { NodeCard } from './BaseNode/NodeCard';
import { CustomHandle } from './CustomHandle';

export interface DefaultNodeProps {
  readonly id: string;
  readonly data?: { readonly isPerforming?: boolean };
  readonly selected?: boolean;
  readonly type: string;
  readonly versionTools?: readonly PipelineToolEntry[];
}

interface DefaultNodeYamlState {
  readonly isRunningPipeline: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly isEntrypoint: boolean;
  readonly yamlJsonObject: FlowEditorContextValue['yamlJsonObject'] | undefined;
  readonly setYamlJsonObject: FlowEditorContextValue['setYamlJsonObject'] | undefined;
  readonly yamlNode: YamlPipelineNode | undefined;
}

/** Groups every `FlowEditorContext`-derived read this component needs -- split out purely to keep `DefaultNode` under the §3.5 complexity ceiling (matching `BaseToolNode.tsx`'s own `useBaseToolNodeYamlState`). */
function useDefaultNodeYamlState(id: string): DefaultNodeYamlState {
  const flowEditorContext = useContext(FlowEditorContext);
  const yamlJsonObject = flowEditorContext?.yamlJsonObject;
  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find(node => node.id === id), [id, yamlJsonObject?.nodes]);

  return {
    isRunningPipeline: flowEditorContext?.isRunningPipeline,
    disabled: flowEditorContext?.disabled,
    isEntrypoint: yamlJsonObject?.entry_point === id,
    yamlJsonObject,
    setYamlJsonObject: flowEditorContext?.setYamlJsonObject,
    yamlNode,
  };
}

/** `useFunctionInputMapping` requires a non-optional `yamlJsonObject`/`setYamlJsonObject`; `FlowEditorContext` itself is optional (never absent in real usage -- see its own doc comment). Split out purely to keep `DefaultNode` under the §3.5 complexity ceiling (each `??` fallback counts as a branch). */
function buildFunctionInputMappingArgs(
  id: string,
  yamlJsonObject: FlowEditorContextValue['yamlJsonObject'] | undefined,
  setYamlJsonObject: FlowEditorContextValue['setYamlJsonObject'] | undefined,
  versionTools: readonly PipelineToolEntry[] | undefined,
): Parameters<typeof useFunctionInputMapping>[0] {
  return {
    id,
    yamlJsonObject: yamlJsonObject ?? {},
    setYamlJsonObject: setYamlJsonObject ?? (() => {}),
    versionTools,
  };
}

interface FunctionOption {
  readonly label: string;
  readonly value: string;
}

/**
 * `DefaultNode.jsx:41-56,58-80` (`toolsWithNames`/`functionOptions`) --
 * split out purely to keep the component under the §3.5 complexity ceiling.
 */
function computeDefaultNodeFunctionOptions(
  toolkit: string | undefined,
  versionTools: readonly PipelineToolEntry[] | undefined,
  getToolkitNameFromSchema: (tool: PipelineToolEntry) => string,
): readonly FunctionOption[] {
  if (!toolkit) return [];

  const toolsWithNames = (versionTools ?? []).map(tool =>
    tool.toolkit_name ? tool : { ...tool, toolkit_name: getToolkitNameFromSchema(tool) },
  );
  if (!toolsWithNames.length) return [];

  const selectedToolkit = toolsWithNames.find(tool => tool.toolkit_name === toolkit || tool.name === toolkit);
  const selectedTools = selectedToolkit?.settings?.['selected_tools'];
  if (!selectedTools) return [];

  return selectedTools
    .map(item => {
      const toolName = getToolName(item);
      return { label: toolName, value: toolName };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

interface ApplyDefaultNodeToolkitSelectionArgs {
  readonly id: string;
  readonly newToolkit: PipelineToolEntry | null;
  readonly toolkitTypes: unknown;
  readonly selectedTool: string;
  readonly currentInputMapping: unknown;
  readonly yamlJsonObject: FlowEditorContextValue['yamlJsonObject'] | undefined;
  readonly setYamlJsonObject: FlowEditorContextValue['setYamlJsonObject'] | undefined;
  readonly getToolkitNameFromSchema: (toolkit: PipelineToolEntry) => string;
}

/** `DefaultNode.jsx:82-122` (`onSelectToolkit`) -- split out purely to keep the component under the §3.5 complexity ceiling. The `yamlJsonObject`/`setYamlJsonObject` presence guard (baseline has none -- `FlowEditorContext` is never optional there) lives here too, for the same reason. */
function applyDefaultNodeToolkitSelection({
  id,
  newToolkit,
  toolkitTypes,
  selectedTool,
  currentInputMapping,
  yamlJsonObject,
  setYamlJsonObject,
  getToolkitNameFromSchema,
}: ApplyDefaultNodeToolkitSelectionArgs): void {
  if (!yamlJsonObject || !setYamlJsonObject) return;
  if (!newToolkit) {
    batchUpdateYamlNode(id, { toolkit_name: undefined, tool: undefined, input_mapping: undefined }, yamlJsonObject, setYamlJsonObject);
    return;
  }
  const { mapping } = getDefaultInputMappingOfTool(toolkitTypes as never, selectedTool, currentInputMapping as never, newToolkit as never);
  const isApplicationTool = newToolkit.type === ToolTypes.application.value;
  batchUpdateYamlNode(
    id,
    {
      toolkit_name: isApplicationTool ? undefined : (newToolkit.toolkit_name ?? getToolkitNameFromSchema(newToolkit)),
      tool: isApplicationTool ? newToolkit.name : undefined,
      input_mapping: { ...mapping },
    },
    yamlJsonObject,
    setYamlJsonObject,
  );
}

interface DefaultNodeHandlesProps {
  readonly isRunningPipeline: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly isPerforming: boolean | undefined;
}

/** `DefaultNode.jsx:132-151` (the `handles` render-prop body) as its own named component. */
function DefaultNodeHandles({ isRunningPipeline, disabled, isPerforming }: DefaultNodeHandlesProps): ReactNode {
  return (
    <>
      <CustomHandle
        type="target"
        id="target"
        isConnectable={!isRunningPipeline && !disabled}
        isRunningPipeline={Boolean(isRunningPipeline)}
        isPerforming={Boolean(isPerforming)}
      />
      <CustomHandle
        type="source"
        id="source"
        isConnectable={!isRunningPipeline && !disabled}
        isRunningPipeline={Boolean(isRunningPipeline)}
        isPerforming={Boolean(isPerforming)}
      />
    </>
  );
}

interface DefaultNodeToolFunctionSelectProps {
  readonly functionOptions: readonly FunctionOption[];
  readonly selectedTool: string;
  readonly onChangeTool: (newValue: string | undefined) => void;
  readonly disabled: boolean;
}

/** `DefaultNode.jsx:159-170` (the conditional "Tool" select) as its own named component -- split out purely to keep `DefaultNode` under the §3.5 complexity ceiling (matching `BaseToolNode.tsx`'s own `ToolFunctionSelect`). */
function DefaultNodeToolFunctionSelect({ functionOptions, selectedTool, onChangeTool, disabled }: DefaultNodeToolFunctionSelectProps): ReactNode {
  if (functionOptions.length === 0) return null;
  return (
    <SingleSelect
      label={t('pipelines.flowEditor.defaultNode.toolLabel', 'Tool')}
      value={selectedTool}
      onChange={onChangeTool}
      options={[...functionOptions]}
      disabled={disabled}
    />
  );
}

function DefaultNodeComponent(props: DefaultNodeProps): ReactNode {
  const { id, data, selected, type, versionTools } = props;

  const { isRunningPipeline, disabled, isEntrypoint, yamlJsonObject, setYamlJsonObject, yamlNode } = useDefaultNodeYamlState(id);

  const { onChangeTool, onChangeMapping, toolkitTypes, requiredInputs, mappingInfo, inputMappings, defaultValues, selectedTool, toolkit } =
    useFunctionInputMapping(buildFunctionInputMappingArgs(id, yamlJsonObject, setYamlJsonObject, versionTools));

  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);

  const functionOptions = useMemo(
    () => computeDefaultNodeFunctionOptions(toolkit, versionTools, getToolkitNameFromSchema),
    [toolkit, versionTools, getToolkitNameFromSchema],
  );

  const onSelectToolkit = useCallback(
    (newToolkit: PipelineToolEntry | null) => {
      applyDefaultNodeToolkitSelection({
        id,
        newToolkit,
        toolkitTypes,
        selectedTool,
        currentInputMapping: yamlNode?.input_mapping,
        yamlJsonObject,
        setYamlJsonObject,
        getToolkitNameFromSchema,
      });
    },
    [id, setYamlJsonObject, yamlJsonObject, toolkitTypes, selectedTool, yamlNode?.input_mapping, getToolkitNameFromSchema],
  );

  const isDisabled = Boolean(isRunningPipeline || disabled);

  return (
    <NodeCard
      name={id}
      isEntrypoint={isEntrypoint}
      selected={Boolean(selected)}
      type={type}
      isPerforming={Boolean(data?.isPerforming)}
      id={id}
      handles={() => (
        <DefaultNodeHandles
          isRunningPipeline={isRunningPipeline}
          disabled={disabled}
          isPerforming={data?.isPerforming}
        />
      )}
    >
      <ToolSelect
        onSelectTool={onSelectToolkit}
        selectedToolkit={toolkit ?? ''}
        disabled={isDisabled}
        versionTools={versionTools ?? []}
      />
      <DefaultNodeToolFunctionSelect
        functionOptions={functionOptions}
        selectedTool={selectedTool}
        onChangeTool={onChangeTool}
        disabled={isDisabled}
      />
      <InputSelect
        id={id}
        inputFieldName="input"
        disabled={isDisabled}
      />
      <OutputSelect
        id={id}
        label={t('pipelines.flowEditor.defaultNode.outputLabel', 'Output')}
        outputFieldName="output"
        disabled={isDisabled}
      />
      <InputMapping
        requiredInputs={requiredInputs}
        mappingInfo={mappingInfo as never}
        input_mapping={inputMappings as never}
        defaultValues={defaultValues}
        values={yamlNode?.input_mapping ?? {}}
        onChangeMapping={onChangeMapping}
        disabled={isDisabled}
      />
      <CommonInterruptSettings
        id={id}
        showStructuredOutput
        type={type}
        disabled={isDisabled}
      />
      <CustomNodeInput id={id} />
    </NodeCard>
  );
}

/** `DefaultNode.jsx:205-214` verbatim -- compares every prop except `data.isPerforming` (which changes during a canvas drag) to avoid re-rendering on every drag frame. */
function arePropsEqual(prevProps: DefaultNodeProps, nextProps: DefaultNodeProps): boolean {
  return (
    prevProps.id === nextProps.id &&
    prevProps.selected === nextProps.selected &&
    prevProps.type === nextProps.type &&
    prevProps.data?.isPerforming === nextProps.data?.isPerforming
  );
}

export const DefaultNode = memo(DefaultNodeComponent, arePropsEqual);
