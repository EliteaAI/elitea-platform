import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { SingleSelect, type SingleSelectOption } from '@/shared/ui/SingleSelect';

import { getToolName } from '../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineNode } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { useGetToolkitNameFromSchema } from '../../lib/flow-editor/hooks/useGetToolkitNameFromSchema';
import { useSelectedProjectId } from '../../lib/flow-editor/hooks/useSelectedProjectId';
import { useToolkitTypeSchemas } from '../../lib/flow-editor/hooks/useToolkitTypeSchemas';
import { EntityOptionIcon, resolvePipelineToolEntityType } from './EntityOptionIcon';
import type { PipelineToolEntry } from './pipelineToolEntry.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * select/LoopToolSelect.jsx` (unit A2h) -- deprecated-node picker (a
 * toolkit select plus a tool/function select), consumed by the
 * `Loop`/`LoopFromTool` node UI (`../../lib/flow-editor/constants/
 * deprecated.constants.ts`).
 *
 * DEVIATIONS FROM BASELINE, both following this batch's own precedent
 * (`../../lib/flow-editor/hooks/useFunctionInputMapping.ts`'s header):
 *
 *  1. `useFormikContext()` -> explicit `versionTools` prop (no Formik).
 *  2. `useGetToolkitNameFromSchema()`/`useGetToolkitIconMeta()` -> locally
 *     resolved `toolkitTypeSchemas` + `EntityOptionIcon`'s entity-type
 *     fallback (see `ToolSelect.tsx`'s identical deviation #2).
 *
 * **Real, disclosed backend gap, NOT papered over** (baseline:
 * `useToolkitAvailableToolsQuery`, `api/toolkits.js:515` -- dynamic MCP
 * tool-name discovery for a toolkit with no explicit `selected_tools`).
 * No generated endpoint for this exists -- confirmed against
 * `shared/api/generated/toolkits/toolkits.ts`'s full export list
 * (`useListToolkits`/`useListToolkitInstances` only), the SAME gap
 * `useFunctionInputMapping.ts`'s own header documents in full for its
 * `dynamicToolNames`. This component's "Tool" dropdown is therefore
 * populated ONLY from `selectedToolkit.settings.selected_tools` when
 * present; a toolkit relying on the baseline's dynamic MCP tool-name
 * fetch shows no tool options here today.
 *
 * `useLoopToolSelection` bundles every derived-options computation into
 * one hook purely to keep this component's own cyclomatic complexity under
 * the §3.5 budget (12); no behaviour change.
 */
export interface LoopToolSelectProps {
  readonly yamlNode?: YamlPipelineNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly label?: string;
  readonly toolkitField?: string;
  readonly toolField?: string;
  readonly onChangeToolkit?: (value: string | null) => void;
  readonly onChangeTool?: (value: string) => void;
  readonly versionTools?: readonly PipelineToolEntry[];
}

interface ToolkitOption extends SingleSelectOption {
  readonly originalTool: PipelineToolEntry;
}

const noop = (): void => {};
const toolkitSelectSx: SxProps<Theme> = { marginBottom: '0rem' };
const toolSelectSx: SxProps<Theme> = { marginBottom: '0rem' };

interface LoopToolSelection {
  readonly toolkits: readonly ToolkitOption[];
  readonly toolkit: string | undefined;
  readonly functionOptions: readonly SingleSelectOption[];
}

function useLoopToolSelection(yamlNode: YamlPipelineNode | undefined, toolkitField: string, toolField: string, versionTools: readonly PipelineToolEntry[]): LoopToolSelection {
  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);

  const toolkits = useMemo<ToolkitOption[]>(
    () =>
      versionTools.map((tool): ToolkitOption => {
        const name = tool.type === 'application' ? (tool.name ?? '') : (tool.toolkit_name ?? getToolkitNameFromSchema(tool));
        return { label: name, value: name, icon: <EntityOptionIcon entityType={resolvePipelineToolEntityType(tool)} />, originalTool: tool };
      }),
    [getToolkitNameFromSchema, versionTools],
  );

  const toolkit = useMemo(() => {
    if (!yamlNode) return undefined;
    return (yamlNode[toolkitField] as string | undefined) ?? (yamlNode[toolField] as string | undefined) ?? yamlNode.id;
  }, [yamlNode, toolField, toolkitField]);

  const selectedToolkit = useMemo(
    () => versionTools.find(tool => tool.toolkit_name === toolkit || tool.name === toolkit || toolkit === getToolkitNameFromSchema(tool)),
    [getToolkitNameFromSchema, toolkit, versionTools],
  );

  // Real, disclosed gap (see module doc comment): no dynamic MCP tool-name
  // fetch exists, so only an explicit `selected_tools` list ever populates
  // this dropdown.
  const functionOptions = useMemo<SingleSelectOption[]>(() => {
    const enabledTools = selectedToolkit?.settings?.selected_tools ?? [];
    return enabledTools.map(item => ({ label: getToolName(item), value: getToolName(item) }));
  }, [selectedToolkit?.settings?.selected_tools]);

  return { toolkits, toolkit, functionOptions };
}

export function LoopToolSelect(props: LoopToolSelectProps): ReactNode {
  const {
    yamlNode,
    disabled = false,
    label = 'Toolkit',
    toolkitField = 'toolkit_name',
    toolField = 'tool',
    onChangeToolkit = noop,
    onChangeTool = noop,
    versionTools = [],
  } = props;

  const selectedTool = useMemo(() => (yamlNode ? ((yamlNode[toolField] as string | undefined) ?? '') : ''), [toolField, yamlNode]);
  const { toolkits, toolkit, functionOptions } = useLoopToolSelection(yamlNode, toolkitField, toolField, versionTools);

  const handleToolkitChange = useCallback((newValue: string) => onChangeToolkit(newValue), [onChangeToolkit]);
  const onClear = useCallback(() => onChangeToolkit(null), [onChangeToolkit]);

  const toolLabel = toolField === 'tool' ? t('pipelines.loopToolSelect.tool', 'Tool') : t('pipelines.loopToolSelect.loopTool', 'Loop tool');

  return (
    <>
      <SingleSelect
        sx={toolkitSelectSx}
        label={label}
        value={toolkit ?? ''}
        onChange={handleToolkitChange}
        onClear={onClear}
        options={[...toolkits]}
        disabled={disabled || toolkits.length === 0}
      />
      {functionOptions.length > 0 && (
        <SingleSelect
          sx={toolSelectSx}
          label={toolLabel}
          value={selectedTool}
          onChange={onChangeTool}
          options={[...functionOptions]}
          disabled={disabled}
        />
      )}
    </>
  );
}
