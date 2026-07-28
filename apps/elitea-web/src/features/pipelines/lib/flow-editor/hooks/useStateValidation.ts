/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useStateValidation.hooks.js` (48 lines, unit A2d).
 *
 * DISCLOSED REDESIGN: the baseline dispatches to a Redux slice
 * (`slices/pipeline.js`'s `stateValidationErrors` reducers). Routed
 * through `../../model/pipelineEditorStore.ts` instead — see that file's
 * doc comment for the full rationale (same swap as
 * `useSaveNodeAndEdges.ts`).
 */
import { useCallback, useEffect } from 'react';

import { StateDefaultProps } from '../constants/flowEditor.constants';
import { validateValueByType } from '../helpers/state.helpers';
import { usePipelineEditorStore } from '../../../model/pipelineEditorStore';

export interface StateVariableConfig {
  readonly type?: string;
  readonly value?: unknown;
}

export interface UseStateValidationResult {
  readonly validateVariable: (name: string, type: string, value: unknown) => string;
  readonly clearValidationError: (name: string) => void;
  readonly clearAllValidationErrors: () => void;
}

/**
 * Validates every state variable on mount and whenever `states` changes,
 * caching results in the pipeline-editor store; also exposes an imperative
 * single-variable validator for onChange handlers.
 */
export function useStateValidation(states: Readonly<Record<string, StateVariableConfig>> | undefined): UseStateValidationResult {
  const setStateValidationError = usePipelineEditorStore(state => state.setStateValidationError);
  const clearStateValidationErrors = usePipelineEditorStore(state => state.clearStateValidationErrors);

  useEffect(() => {
    if (!states) {
      clearStateValidationErrors();
      return;
    }

    for (const [name, config] of Object.entries(states)) {
      // Skip default props that don't need validation
      if ((StateDefaultProps as readonly string[]).includes(name)) continue;

      const type = config.type ?? 'str';
      const validationError = validateValueByType(type, config.value);

      setStateValidationError(name, validationError || null);
    }
  }, [states, setStateValidationError, clearStateValidationErrors]);

  const validateVariable = useCallback(
    (name: string, type: string, value: unknown): string => {
      const validationError = validateValueByType(type, value);
      setStateValidationError(name, validationError || null);
      return validationError;
    },
    [setStateValidationError],
  );

  const clearValidationError = useCallback(
    (name: string) => {
      setStateValidationError(name, null);
    },
    [setStateValidationError],
  );

  const clearAllValidationErrors = useCallback(() => {
    clearStateValidationErrors();
  }, [clearStateValidationErrors]);

  return { validateVariable, clearValidationError, clearAllValidationErrors };
}
