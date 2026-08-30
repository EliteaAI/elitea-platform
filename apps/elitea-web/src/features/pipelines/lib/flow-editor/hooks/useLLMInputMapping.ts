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
import { useCallback, useContext, useMemo } from 'react';

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

  /*
   * OPENING A DOCUMENT MUST NOT MODIFY IT — so there is no init effect here.
   *
   * There was one, and it wrote `input_mapping` on mount whenever any of the
   * three keys was absent. Two bugs came out of that, both measured:
   *
   *  1. It wrote `defaultMapping` WHOLESALE, so a node storing only the key
   *     its author set — `task: {type: variable, value: input}`, the shape the
   *     runtime needs — had that replaced by an empty `fixed` entry just by
   *     being looked at. Saving persisted the loss; running the graph then
   *     failed at `stage="input_mapping"`.
   *  2. Even merged, it still ADDED the two absent keys, so the document
   *     differed from the stored one the moment the card mounted. That armed
   *     the unsaved-changes guard on a pipeline nobody had touched: the
   *     test-chat pane stayed shut and the "Chat with pipeline" button's own
   *     navigation opened a "You have unsaved changes" dialog instead of
   *     going anywhere.
   *
   * Both were intermittent, because React Flow only mounts the cards
   * currently in view — measured at roughly 1 in 5 through
   * `e2e/streaming/chat.pipeline.spec.ts`.
   *
   * Nothing needed the write. `inputMappings` above already merges the
   * defaults in for DISPLAY, which is the only consumer (`LLMNode.parts.tsx`
   * renders from it, not from the raw node), and `onChangeMapping` below
   * writes the complete merged mapping the first time the user actually
   * edits one. A partial mapping is also legal at runtime: the worker uses
   * what it is given and only falls back to `messages` when the key is
   * absent entirely.
   *
   * Deliberately NOT the baseline's behaviour (`useLLMInputMapping.js:44-52`).
   */

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
