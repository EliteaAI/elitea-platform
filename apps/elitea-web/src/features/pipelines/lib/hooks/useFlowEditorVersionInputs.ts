import { useMemo } from 'react';

import type { AiAssistantLlmSettings } from '../../api/aiAssistantPredict';
import type { PipelineToolEntry } from '../../ui/select/pipelineToolEntry.types';
import { toAiAssistantLlmSettings, toPipelineToolEntries, type WireLlmSettingsLike } from '../flowEditorVersionInputs.helpers';

export interface UseFlowEditorVersionInputsResult {
  readonly versionTools: readonly PipelineToolEntry[];
  readonly llmSettings: AiAssistantLlmSettings;
}

/** The two fields this hook reads off a version -- takes the whole object (both `ChatPipelineVersionDetails` and `ApplicationVersionDetail` satisfy this structurally) so callers pass `versionDetails` straight through instead of two separately-optional-chained fields, which would push the `?.`s back into each caller's own complexity budget. */
export interface FlowEditorVersionInputsSource {
  readonly tools?: readonly unknown[] | undefined;
  readonly llm_settings?: WireLlmSettingsLike | undefined;
}

/**
 * `EditorPanel`'s `versionTools`/`llmSettings` props (`FlowWrapper.tsx`'s
 * own module doc comment names them the real plumbing gap), memoised once
 * here rather than as two inline `useMemo`s duplicated at each of
 * `EditorPanel`'s two real callers (`ConfigurationTab.tsx`,
 * `PipelineEditorParts.tsx`'s `PipelineEditorBody`) -- both need the exact
 * same mapping+memoisation (`useFlowEditorNodeTypes.tsx`'s own doc comment:
 * `nodeTypes`/`edgeTypes`, and every flow node, only rebuild when these two
 * values themselves change), and inlining it separately at each call site
 * pushed both callers' own functions over the §3.5 complexity budget.
 */
export function useFlowEditorVersionInputs(versionDetails: FlowEditorVersionInputsSource | undefined): UseFlowEditorVersionInputsResult {
  const versionTools = useMemo(() => toPipelineToolEntries(versionDetails?.tools), [versionDetails?.tools]);
  const aiAssistantLlmSettings = useMemo(() => toAiAssistantLlmSettings(versionDetails?.llm_settings), [versionDetails?.llm_settings]);
  return useMemo(() => ({ versionTools, llmSettings: aiAssistantLlmSettings }), [versionTools, aiAssistantLlmSettings]);
}
