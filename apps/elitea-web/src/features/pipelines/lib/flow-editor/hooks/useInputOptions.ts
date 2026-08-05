/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useInputOptions.hooks.js` (23 lines, unit A2d). Reads
 * `../flowEditorContext.ts`'s `FlowEditorContext` instead of the baseline's
 * `app/providers` import -- see that file's header for the R-L1 rationale.
 *
 * `sortWithPriority` (baseline: `shared/lib/helpers/shared.helpers.js:20-31`)
 * is NOT present anywhere in this app's `src/shared/lib/**` (checked
 * directly -- S3's port missed it). A generic, self-contained, domain-free
 * sort utility with a single real call site (this hook) -- duplicated
 * locally rather than reached for cross-slice, matching this batch's
 * "confirmed not promoted, port it yourself" precedent.
 */
import { useContext, useMemo } from 'react';

import { StateVariableTypes } from '../constants/flowEditor.constants';
import { FlowEditorContext } from '../flowEditorContext';
import type { NodeOption } from './useNodeOptions';

/** `shared.helpers.js:20-31` verbatim -- case-insensitive, numeric-aware ordering, priority keys first. */
function sortWithPriority(items: readonly string[], priorityOrderItems: readonly string[]): string[] {
  const collatorOptions = { sensitivity: 'base' as const, numeric: true };

  const priorityKeys = priorityOrderItems.filter(key => items.includes(key));

  const otherKeys = items
    .filter(key => !priorityOrderItems.includes(key))
    .sort((a, b) => a.localeCompare(b, undefined, collatorOptions));

  return [...priorityKeys, ...otherKeys];
}

export function useInputOptions(): NodeOption[] {
  const context = useContext(FlowEditorContext);
  const state = context?.yamlJsonObject.state;

  return useMemo(() => {
    const stateKeys = Object.keys(state ?? { input: StateVariableTypes.String, messages: StateVariableTypes.List });

    const sortedKeys = sortWithPriority(stateKeys, ['input', 'messages']);

    return sortedKeys.map(variable => ({ label: variable, value: variable }));
  }, [state]);
}
