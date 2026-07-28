/**
 * Ported verbatim (behaviourally) from `apps/elitea-ui/src/hooks/pipeline/
 * useLLMInputMapping.js` (72 lines) — unit A2f.
 *
 * GAP FILL, documented in this mission's own preamble: this baseline file
 * is required by `ui/nodes/LLMNode.tsx` (also A2f) but was not present in
 * ANY sub-unit's owned-file list for the `pipelines` domain partition — the
 * same situation A2e's two hooks (`useCodeInputMapping`/
 * `usePrinterInputMapping`) already document. Ported here, under the same
 * `lib/flow-editor/hooks/` location A2d's sibling hooks already use.
 *
 * Reads `FlowEditorContext` directly via `useContext` (matching this
 * already-landed contract's `useInputOptions.ts`/`useNodeOptions.ts`, A2d) —
 * NOT the "ambient context -> explicit parameter" redesign
 * `useFunctionInputMapping.ts` (also A2d) chose. That hook additionally
 * needed `versionTools` (a Formik-only value with no context equivalent),
 * forcing every one of its inputs to become explicit parameters for
 * consistency; this hook only ever touches `yamlJsonObject`/
 * `setYamlJsonObject`, both of which are genuine `FlowEditorContextValue`
 * fields (`lib/flow-editor/flowEditorContext.ts`), so reading them from
 * context — exactly like the baseline's own `useContext(FlowEditorContext)`
 * (`useLLMInputMapping.js:1,13`) — stays faithful with no redesign needed.
 */
import { useCallback, useContext, useEffect, useMemo } from 'react';

import { batchUpdateYamlNode } from '../helpers/flowEditor.helpers';
import { FlowEditorContext } from '../flowEditorContext';

/** `useLLMInputMapping.js:6-10` verbatim. Module-private: only `LLMInputMapping` (composed from it) is a real external consumer surface. */
interface LLMInputMappingEntry {
  readonly type: string;
  readonly value: unknown;
}

export type LLMInputMapping = Readonly<Record<'system' | 'task' | 'chat_history', LLMInputMappingEntry>>;

export const getDefaultLLMInputMapping = (): LLMInputMapping => ({
  system: { type: 'fixed', value: '' },
  task: { type: 'fixed', value: '' },
  chat_history: { type: 'fixed', value: [] },
});

export interface UseLLMInputMappingArgs {
  readonly id: string;
}

export interface UseLLMInputMappingResult {
  readonly inputMappings: LLMInputMapping;
  readonly onChangeMapping: (key: string, value: LLMInputMappingEntry) => void;
  readonly defaultValues: () => LLMInputMapping;
}

/** `useLLMInputMapping.js:12-72` verbatim behaviour. */
export function useLLMInputMapping({ id }: UseLLMInputMappingArgs): UseLLMInputMappingResult {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject ?? {};
  const setYamlJsonObject = context?.setYamlJsonObject ?? (() => {});

  const yamlNode = useMemo(
    () => yamlJsonObject.nodes?.find(node => node.id === id),
    [id, yamlJsonObject.nodes],
  );

  const inputMappings = useMemo((): LLMInputMapping => {
    const defaultMapping = getDefaultLLMInputMapping();
    const existingMapping = (yamlNode?.input_mapping ?? {}) as Partial<LLMInputMapping>;

    // Merge with defaults, ensuring each property has both type and value.
    const merged = {} as Record<string, LLMInputMappingEntry>;
    for (const key of Object.keys(defaultMapping) as (keyof LLMInputMapping)[]) {
      merged[key] = existingMapping[key] ?? defaultMapping[key];
    }

    return merged as LLMInputMapping;
  }, [yamlNode?.input_mapping]);

  // Initialize YAML input_mapping if it doesn't exist (mirrors useFunctionInputMapping's own init effect).
  useEffect(() => {
    const defaultMapping = getDefaultLLMInputMapping();
    const existingInputMapping = Object.keys(yamlNode?.input_mapping ?? {});
    const requiredInputs = ['system', 'task', 'chat_history'];

    if (!existingInputMapping.length || requiredInputs.some(input => !existingInputMapping.includes(input))) {
      batchUpdateYamlNode(id, { input_mapping: defaultMapping }, yamlJsonObject, setYamlJsonObject);
    }
    // baseline's own deps array (useLLMInputMapping.js:52): `[id, yamlNode?.input_mapping, yamlJsonObject, setYamlJsonObject]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, yamlNode?.input_mapping, yamlJsonObject, setYamlJsonObject]);

  const onChangeMapping = useCallback(
    (key: string, value: LLMInputMappingEntry) => {
      const updatedMapping = { ...inputMappings, [key]: value };
      batchUpdateYamlNode(id, { input_mapping: updatedMapping }, yamlJsonObject, setYamlJsonObject);
    },
    // baseline's own deps array (useLLMInputMapping.js:64): `[id, inputMappings, yamlJsonObject, setYamlJsonObject]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, inputMappings, yamlJsonObject, setYamlJsonObject],
  );

  return {
    inputMappings,
    onChangeMapping,
    defaultValues: getDefaultLLMInputMapping,
  };
}
