/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/hooks/useCtrlASelectAll.hooks.js` (16 lines). Zero
 * sibling dependency beyond `@xyflow/react`'s own `useKeyPress`.
 */
import { useEffect } from 'react';

import { useKeyPress } from '@xyflow/react';

import type { SetFlowEdges, SetFlowNodes } from '../reactFlowTypes';

export interface UseCtrlASelectAllArgs {
  readonly display: string | undefined;
  readonly setFlowNodes: SetFlowNodes;
  readonly setFlowEdges: SetFlowEdges;
}

export function useCtrlASelectAll({ display, setFlowNodes, setFlowEdges }: UseCtrlASelectAllArgs): void {
  const cmdAndAPressed = useKeyPress(['Meta+a', 'Strg+a', 'Control+a'], {
    target: null,
  });

  useEffect(() => {
    if (cmdAndAPressed && display !== 'none') {
      setFlowNodes(prevNodes => prevNodes.map(node => ({ ...node, selected: true })));
      setFlowEdges(prevEdges => prevEdges.map(edge => ({ ...edge, selected: true })));
    }
    // baseline disables exhaustive-deps here too (useCtrlASelectAll.hooks.js:14) — only re-run on key-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdAndAPressed]);
}
