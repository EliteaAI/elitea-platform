/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/deprecated/FunctionNode.jsx` (21 lines) — unit A2g. NOT dead code:
 * still actively registered by the not-yet-built `FlowEditor.jsx` canvas
 * sub-unit (A2k) for pipelines whose stored YAML still uses the legacy
 * `function` node type — see this unit's mission NOTES.
 *
 * A thin, 1:1 wrapper around the already-landed `../BaseToolNode.tsx`
 * (unit A2e) — the baseline itself is nothing but this same delegation
 * (`FlowEditorNodes.BaseToolNode` with `nodeType`/`showStructuredOutput`/
 * `customFilterTypes` fixed). `BaseToolNode`'s own `versionTools` prop
 * (its DISCLOSED REDESIGN: replaces the baseline's ambient
 * `useFormikContext().values.version_details.tools`) is forwarded through
 * unchanged — this component adds no logic of its own beyond that
 * pass-through, matching the baseline exactly.
 */
import type { ReactNode } from 'react';
import { memo, useCallback } from 'react';

import { ToolTypes } from '@/entities/toolkit';

import { PipelineNodeTypes } from '../../../lib/flow-editor/constants/flowEditor.constants';
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { BaseToolNode } from '../BaseToolNode';

export interface FunctionNodeProps {
  readonly id: string;
  readonly data?: { readonly isPerforming?: boolean } | undefined;
  readonly selected?: boolean | undefined;
  /** Forwarded to `BaseToolNode`'s `versionTools` — see that component's own doc comment. */
  readonly versionTools?: readonly PipelineToolEntry[] | undefined;
}

/** `FunctionNode.jsx:8` — application ("agent"/pipeline) associations are excluded from the Function node's toolkit picker. Exported for direct, DOM-free unit testing. */
export function isNotApplicationTool(tool: PipelineToolEntry): boolean {
  return tool.type !== ToolTypes.application.value;
}

export const FunctionNode = memo(function FunctionNode(props: FunctionNodeProps): ReactNode {
  const { id, data = {}, selected = false, versionTools = [] } = props;

  const customFilterTypes = useCallback((tool: PipelineToolEntry) => isNotApplicationTool(tool), []);

  return (
    <BaseToolNode
      id={id}
      data={data}
      selected={selected}
      nodeType={PipelineNodeTypes.Function}
      showStructuredOutput={false}
      customFilterTypes={customFilterTypes}
      versionTools={versionTools}
    />
  );
});
