/**
 * Shared "which YAML field does a picked toolkit value write to" logic
 * (baseline: `LoopNode.jsx:66-79`, `LoopToolNode.jsx:106-121,124-142`) —
 * an `application`-type ("agent"/pipeline") association writes `tool`
 * instead of `toolkit_name`. Factored out once both `LoopNode.tsx` and
 * `LoopToolNode.tsx` need the identical rule, purely to keep each
 * component under the §3.5 `complexity` budget.
 */
import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';

interface ToolkitFieldWrite {
  readonly toolkit_name: string | undefined;
  readonly tool: string | undefined;
}

/**
 * Returned as `Record<string, unknown>` (not the more specific
 * {@link ToolkitFieldWrite}) because every call site forwards it straight
 * into `batchUpdateYamlNode`'s `value: Record<string, unknown>` parameter
 * — an interface without an index signature is not assignable to that
 * type even though every field it declares is compatible, a known TS
 * limitation for exactly this shape (same fix already applied at
 * `useToolNodeEditing.ts`'s `resolveFunctionOptions`).
 */
export function resolveToolkitFieldWrite(toolkitDetails: PipelineToolEntry | undefined, newValue: string): Record<string, unknown> {
  const isApplication = toolkitDetails?.type === 'application';
  const write = { toolkit_name: isApplication ? undefined : newValue, tool: isApplication ? newValue : undefined } satisfies ToolkitFieldWrite;
  return write;
}
