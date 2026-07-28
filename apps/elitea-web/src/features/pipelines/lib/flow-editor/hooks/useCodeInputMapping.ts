/**
 * Ported from `apps/elitea-ui/src/hooks/pipeline/useCodeInputMapping.js` (81
 * lines, unit A2e). Gap-fill: this file was found needed by
 * `ui/nodes/CodeNode.jsx` but missing from every sub-unit's original owned-
 * file list (a real F5 partition gap, not a boundary dispute) -- ported
 * here since it co-locates with its consumer, `../../ui/nodes/CodeNode.tsx`
 * (also owned by this sub-unit).
 *
 * Reads `../flowEditorContext.ts`'s `FlowEditorContext` instead of the
 * baseline's `app/providers` import -- see that file's header for the R-L1
 * rationale (same convention already established by A2d's
 * `useInputOptions.ts`/`useNodeOptions.ts`). Lives in `lib/flow-editor/
 * hooks/`, matching where those sibling hooks landed.
 */
import { useCallback, useContext, useEffect, useMemo } from 'react';

import { batchUpdateYamlNode } from '../helpers/flowEditor.helpers';
import { FlowEditorContext } from '../flowEditorContext';

/** `useCodeInputMapping.js:6-11` verbatim. */
export function getDefaultCodeInputMapping(): { readonly code: { readonly type: 'fixed'; readonly value: string } } {
  return {
    code: {
      type: 'fixed',
      value: '',
    },
  };
}

export interface UseCodeInputMappingParams {
  readonly id: string;
}

export interface UseCodeInputMappingResult {
  readonly inputMappings: { readonly code: { readonly type: string; readonly value: string } };
  readonly onChangeMapping: (key: string, value: { readonly type: string; readonly value: string }) => void;
  readonly defaultValues: { readonly code: string };
}

export function useCodeInputMapping({ id }: UseCodeInputMappingParams): UseCodeInputMappingResult {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;
  const setYamlJsonObject = context?.setYamlJsonObject;

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id),
    [id, yamlJsonObject?.nodes],
  );

  const inputMappings = useMemo(() => {
    const defaultMapping = getDefaultCodeInputMapping();
    // `code` is typed as `{ type, value } | undefined` (`pipelineFlow.types.ts`),
    // but the baseline also tolerated a bare legacy string -- the runtime
    // guard below preserves that defensiveness (`useCodeInputMapping.js:26-38`).
    const existingCode = yamlNode?.code as unknown;

    if (
      existingCode !== undefined &&
      existingCode !== null &&
      typeof existingCode === 'object' &&
      'type' in existingCode &&
      'value' in existingCode &&
      (existingCode as { value: unknown }).value !== undefined
    ) {
      return { code: existingCode as { type: string; value: string } };
    }

    if (typeof existingCode === 'string') {
      return { code: { type: 'fixed', value: existingCode } };
    }

    return defaultMapping;
  }, [yamlNode?.code]);

  // Initialize the YAML code field if it doesn't exist (`useCodeInputMapping.js:43-56`).
  useEffect(() => {
    const defaultMapping = getDefaultCodeInputMapping();
    const existingCode = yamlNode?.code;

    if (!existingCode && setYamlJsonObject) {
      batchUpdateYamlNode(id, { code: defaultMapping.code }, yamlJsonObject, setYamlJsonObject);
    }
  }, [id, yamlNode?.code, yamlJsonObject, setYamlJsonObject]);

  const onChangeMapping = useCallback(
    (_key: string, value: { readonly type: string; readonly value: string }) => {
      if (setYamlJsonObject) {
        batchUpdateYamlNode(id, { code: value }, yamlJsonObject, setYamlJsonObject);
      }
    },
    [id, yamlJsonObject, setYamlJsonObject],
  );

  // Return only the value part for defaultValues, not the entire object (`useCodeInputMapping.js:65-71`).
  const defaultValues = useMemo(() => ({ code: getDefaultCodeInputMapping().code.value }), []);

  return {
    inputMappings,
    onChangeMapping,
    defaultValues,
  };
}
