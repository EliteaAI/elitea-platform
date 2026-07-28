import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';

import { SingleSelect, type SingleSelectOption } from '@/shared/ui/SingleSelect';

import { useIsMcpVisible } from '../../api/useIsMcpVisible';
import { useGetToolkitNameFromSchema } from '../../lib/flow-editor/hooks/useGetToolkitNameFromSchema';
import { useSelectedProjectId } from '../../lib/flow-editor/hooks/useSelectedProjectId';
import { useToolkitTypeSchemas } from '../../lib/flow-editor/hooks/useToolkitTypeSchemas';
import { EntityOptionIcon, resolvePipelineToolEntityType } from './EntityOptionIcon';
import type { PipelineToolEntry } from './pipelineToolEntry.types';

/**
 * `mcp.helpers.js:7-14` (`isMcpToolkitType`/`isMcpToolkit`), inlined
 * rather than imported from `entities/toolkit`'s `isMcpToolkit`: that
 * export's parameter type (`Toolkit`) requires `id`/`name`/`online`
 * fields a `version_details.tools[]` entry does not reliably carry --
 * same situation, same fix, `../../lib/flow-editor/hooks/
 * useFunctionInputMapping.ts`'s own `isMcpToolkitLike` (its header
 * documents the identical rationale in full).
 */
function isMcpToolkitLike(tool: PipelineToolEntry): boolean {
  if (!tool.type) return false;
  if (tool.type === 'mcp' || tool.type.startsWith('mcp_')) return true;
  return tool.meta?.mcp === true;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * select/ToolSelect.jsx` (unit A2h). Single-value, so this stays on
 * `shared/ui/SingleSelect` (unit S1-D) unlike its `ui/select/` siblings --
 * see `InputSelect.tsx`'s doc comment for why the others cannot.
 *
 * DEVIATIONS FROM BASELINE:
 *  1. `useFormikContext()` (`values.version_details.tools`) -> an explicit
 *     `versionTools` prop (no Formik in this app).
 *  2. `useGetToolkitNameFromSchema()`/`useGetToolkitIconMeta()` (baseline:
 *     ambient Redux-cached schema reads) -> `toolkitTypeSchemas` resolved
 *     locally (`useToolkitTypeSchemas`/`useSelectedProjectId`); the
 *     per-toolkit-brand icon (`getToolkitIconMeta`) is replaced by
 *     `EntityOptionIcon`'s entity-type-only fallback -- see that file's
 *     own "DISCLOSED SIMPLIFICATION" doc comment.
 *  3. `useIsMcpVisible` -> this slice's own local duplicate
 *     (`../../api/useIsMcpVisible.ts`, `no-sideways-features`).
 */
export interface ToolSelectProps {
  readonly disabled?: boolean | undefined;
  readonly label?: string;
  readonly selectedToolkit?: string;
  readonly onSelectTool?: (tool: PipelineToolEntry | null) => void;
  readonly filterTypes?: (tool: PipelineToolEntry) => boolean;
  readonly versionTools?: readonly PipelineToolEntry[];
}

const defaultFilterTypes = (): boolean => true;

const selectSx: SxProps<Theme> = { marginBottom: '0rem' };

interface ToolOption extends SingleSelectOption {
  readonly originalTool: PipelineToolEntry;
}

export function ToolSelect(props: ToolSelectProps): ReactNode {
  const {
    disabled = false,
    label = 'Toolkit',
    selectedToolkit = '',
    onSelectTool,
    filterTypes = defaultFilterTypes,
    versionTools = [],
  } = props;

  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas } = useToolkitTypeSchemas(projectId);
  const { getToolkitNameFromSchema } = useGetToolkitNameFromSchema(toolkitTypeSchemas);
  const isMcpVisible = useIsMcpVisible();

  const tools = useMemo<ToolOption[]>(
    () =>
      versionTools
        .filter(filterTypes)
        .filter(tool => isMcpVisible || !isMcpToolkitLike(tool))
        .map((tool): ToolOption => {
          const name = tool.type === 'application' ? (tool.name ?? '') : (tool.toolkit_name ?? getToolkitNameFromSchema(tool));
          return {
            label: name,
            value: name,
            icon: <EntityOptionIcon entityType={resolvePipelineToolEntityType(tool)} />,
            originalTool: tool,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [filterTypes, getToolkitNameFromSchema, versionTools, isMcpVisible],
  );

  const onChangeTool = useCallback(
    (newValue: string) => {
      const found = tools.find(tool => tool.value === newValue);
      onSelectTool?.(found ? found.originalTool : null);
    },
    [onSelectTool, tools],
  );

  const onClear = useCallback(() => {
    onSelectTool?.(null);
  }, [onSelectTool]);

  return (
    <SingleSelect
      sx={selectSx}
      label={label}
      value={selectedToolkit}
      onChange={onChangeTool}
      onClear={onClear}
      options={tools}
      disabled={disabled}
    />
  );
}
