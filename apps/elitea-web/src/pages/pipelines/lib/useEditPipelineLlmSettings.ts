import { useCallback, useRef, useState } from 'react';

import {
  areAgentLlmSettingsEqual,
  toAgentLlmSettings,
  type AgentLlmSettings,
} from '@/shared/api/agentLlmSettings';
import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

export interface EditPipelineLlmSettingsState {
  /** The model this version will be saved with, or `undefined` while it names none. */
  readonly value: AgentLlmSettings | undefined;
  readonly setValue: (next: AgentLlmSettings) => void;
  /** Feeds the page's nav blocker — RHF's own `isDirty` cannot see this field, it is not in `applicationCreationSchema`. */
  readonly isDirty: boolean;
  /** Called after a successful save so the model just persisted stops counting as unsaved. */
  readonly markSaved: () => void;
  /** The discard direction — reverts the picked model back to the last-saved/loaded one. `markSaved` moves the baseline TO the current value; a discard must do the opposite, or `useEditPipelineForm`'s save body would still carry the "discarded" pick. */
  readonly reset: () => void;
}

/**
 * The model `EditPipeline`'s picker edits, held outside the RHF form for the
 * same reason `pages/agents/lib/useEditApplicationVersionFields.ts` holds the
 * agent editor's version-level fields there: `applicationCreationSchema`
 * validates only name/description/`conversation_starters`, so widening the
 * form's generic would need an unsound resolver cast for a field nothing
 * validates.
 *
 * The pipeline page has no equivalent of that hook because its configuration
 * form is still a disclosed gap (`./pipelineConfigurationTabGaps.tsx`) — this
 * is the one version-level field it can actually edit, so it gets the one
 * state slice rather than a speculative bag of five.
 *
 * @param activeVersion Seeded from it on arrival and RE-seeded only when the
 * version's IDENTITY changes (a version switch), never on a new response
 * object for the same version: the detail query refetches on window focus and
 * after sibling mutations, and keying the resync on object identity would
 * throw away a model the user had just picked.
 */
export function useEditPipelineLlmSettings(
  activeVersion: ApplicationVersionDetail | undefined,
): EditPipelineLlmSettingsState {
  const [value, setValue] = useState<AgentLlmSettings | undefined>(() => toAgentLlmSettings(activeVersion?.llm_settings));
  const [baseline, setBaseline] = useState<AgentLlmSettings | undefined>(value);
  // `undefined` while the detail fetch is in flight, which is the ordinary
  // first render — the seed below fires as soon as the real version resolves.
  const seededFrom = useRef<string | undefined>(activeVersion?.id);

  // A render-phase resync rather than an effect: an effect renders one frame
  // of the empty state over a version that has already arrived, the staleness
  // `pages/agents/lib/useEditApplicationEditorBridge.ts` records hitting on
  // the sibling page.
  if (seededFrom.current !== activeVersion?.id) {
    seededFrom.current = activeVersion?.id;
    const seeded = toAgentLlmSettings(activeVersion?.llm_settings);
    setValue(seeded);
    setBaseline(seeded);
  }

  const markSaved = useCallback(() => setBaseline(value), [value]);
  const reset = useCallback(() => setValue(baseline), [baseline]);

  return { value, setValue, isDirty: !areAgentLlmSettingsEqual(value, baseline), markSaved, reset };
}
