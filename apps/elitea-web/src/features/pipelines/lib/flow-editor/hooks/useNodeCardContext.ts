/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useNodeCardContext.hooks.js` (10 lines, unit A2d). Reads
 * `../flowEditorContext.ts`'s `NodeCardContext` -- see that file's header
 * for why the context now lives in `lib/` rather than `app/providers`
 * (R-L1).
 */
import { useContext } from 'react';

import { NodeCardContext, type NodeCardContextValue } from '../flowEditorContext';

export function useNodeCardContext(): NodeCardContextValue | undefined {
  return useContext(NodeCardContext);
}
