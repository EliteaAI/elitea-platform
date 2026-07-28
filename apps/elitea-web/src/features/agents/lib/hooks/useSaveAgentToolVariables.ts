import { useCallback, useState } from 'react';

import type { AgentToolAssociation, AgentToolVariable } from '../types';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useSaveAgentToolVariables.js`.
 *
 * **DEVIATION FROM BASELINE (disclosed):** the baseline reads/writes
 * `version_details.tools` via `useFormikContext()` (`setFieldValue`,
 * `values`). This app uses react-hook-form, not Formik (`package.json` has
 * no `formik` dependency — confirmed absent from `node_modules`), and
 * matching this codebase's established convention for exactly this
 * situation — see `features/agents/lib/useAgentAttachments.ts`'s and
 * `features/agents/lib/useFilterAddedItems.ts`'s own "DEVIATION FROM
 * BASELINE" doc comments, both already landed in this same slice —
 * `features/` hooks should not assume a specific form library is mounted
 * above them. `tools`/`onChangeTools` are therefore explicit parameters
 * instead: the caller (the tool-card composition UI, out of this unit's
 * scope) passes the current `tools[]` field value and a setter, the same
 * way it would pass any other controlled value.
 *
 * `AgentToolAssociation`/`AgentToolVariable` (`../types.ts`) are this
 * slice's already-landed shared local types for a version's `tools[]`
 * association-row entries — reused here (intra-slice) rather than
 * re-declared.
 */
export interface UseSaveAgentToolVariablesParams {
  readonly tool: AgentToolAssociation;
  /** The current `tools[]` array this tool entry lives in — the caller's controlled form field value. */
  readonly tools: readonly AgentToolAssociation[];
  /** Replaces the whole `tools[]` array — the caller's form-field setter (e.g. react-hook-form's `setValue('versionDetails.tools', ...)`). */
  readonly onChangeTools: (tools: readonly AgentToolAssociation[]) => void;
}

export interface UseSaveAgentToolVariablesResult {
  readonly showVariables: boolean;
  readonly onToggleVariables: (event: { readonly stopPropagation: () => void }) => void;
  readonly variables: readonly AgentToolVariable[];
  readonly onChangeVariable: (label: string, newValue: string) => void;
}

export function useSaveAgentToolVariables({
  tool,
  tools,
  onChangeTools,
}: UseSaveAgentToolVariablesParams): UseSaveAgentToolVariablesResult {
  const [showVariables, setShowVariables] = useState(false);

  const onToggleVariables = useCallback((event: { readonly stopPropagation: () => void }) => {
    event.stopPropagation();
    setShowVariables((prev) => !prev);
  }, []);

  const onChangeVariable = useCallback(
    (label: string, newValue: string) => {
      const toolVariables = tool.variables ?? [];
      onChangeTools(
        tools.map((entry) =>
          entry.id === tool.id
            ? {
                ...entry,
                variables: toolVariables.map((variable) =>
                  variable.name === label ? { name: label, value: newValue } : variable,
                ),
              }
            : entry,
        ),
      );
    },
    [onChangeTools, tool.id, tool.variables, tools],
  );

  return {
    showVariables,
    onToggleVariables,
    variables: tool.variables ?? [],
    onChangeVariable,
  };
}
