/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/McpNode.jsx` (25 lines, unit A2e). A thin wrapper around
 * `BaseToolNode` (this sub-unit's own sibling) -- `../settings/InputMapping`/
 * `CommonInterruptSettings` (unit A2h) have since landed (verified: both
 * files exist under `ui/settings/`), so this component no longer inherits
 * any compile blocker from `BaseToolNode`.
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import { ToolTypes } from '@/entities/toolkit';

import { PipelineNodeTypes } from '../../lib/flow-editor/constants/flowEditor.constants';
import { BaseToolNode } from './BaseToolNode';
import type { PipelineToolEntry } from '../select/pipelineToolEntry.types';

export interface McpNodeProps {
  readonly id: string;
  readonly data?: { readonly isPerforming?: boolean };
  readonly selected?: boolean;
  readonly versionTools?: readonly PipelineToolEntry[];
}

function isMcpFilterableTool(tool: PipelineToolEntry): boolean {
  return tool.type !== ToolTypes.application.value && (Boolean(tool.meta?.mcp) || tool.type === PipelineNodeTypes.Mcp);
}

export const McpNode = memo(function McpNode({ id, data, selected, versionTools }: McpNodeProps): ReactNode {
  return (
    <BaseToolNode
      showStructuredOutput // Different from FunctionNode.
      id={id}
      {...(data !== undefined ? { data } : {})}
      {...(selected !== undefined ? { selected } : {})}
      nodeType={PipelineNodeTypes.Mcp}
      customFilterTypes={isMcpFilterableTool}
      {...(versionTools !== undefined ? { versionTools } : {})}
    />
  );
});
