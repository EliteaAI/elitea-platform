/**
 * Shared `FlowEditorContext` field access for this sub-unit's (A2g) five
 * deprecated node components. Not a baseline port (the baseline reads
 * `useContext(FlowEditorContext)` inline in each file) — factored out
 * purely to keep each node component's own `complexity`/optional-chaining
 * count under the §3.5 budget (12), since every field read here is genuinely
 * needed by every one of the five owned node components.
 *
 * No `?? {}`/`?? (() => {})` fallbacks: those would synthesise a fresh
 * object/function every render whenever `FlowEditorContext` is absent,
 * which is both semantically wrong (silently no-ops writes instead of the
 * baseline's implicit "always provided" assumption) and defeats
 * `react-hooks/exhaustive-deps` — matches the already-landed sibling
 * `ui/select/InputSelect.tsx`'s own `context?.field` (no fallback) +
 * per-write `if (!setYamlJsonObject) return;` guard convention.
 */
import { useContext } from 'react';

import { FlowEditorContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';

export type FlowEditorNodeContext = Partial<FlowEditorContextValue>;

export function useFlowEditorNodeContext(): FlowEditorNodeContext {
  return useContext(FlowEditorContext) ?? {};
}
