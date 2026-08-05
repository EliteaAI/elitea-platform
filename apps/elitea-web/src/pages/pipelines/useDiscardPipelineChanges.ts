import { useCallback } from 'react';

import { useFormContext } from 'react-hook-form';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/../Applications/
 * useDiscardApplicationChanges.js` — the shared "reset the in-progress
 * create/edit-application form back to its last-saved values" hook the
 * baseline's `entities/application-tab-bar/ui/ApplicationTabBar.jsx` calls
 * regardless of whether it is currently editing an agent or a pipeline (a
 * Pipeline literally IS an Application row). This unit (A2m) owns
 * `CreatePipeline.tsx`/`EditPipeline.tsx`, the pipelines-domain call sites,
 * and — per `no-sideways-features`/the layer model — cannot import the
 * sibling `pages/agents/useDiscardApplicationChanges.ts` (Wave-2 unit A1g)
 * across a `pages/agents` <-> `pages/pipelines` boundary, so this is an
 * independent, same-body local copy (same "each page-owned surface is
 * independently deletable" posture `pages/pipelines/ui/
 * PipelineListPanel.tsx`'s doc comment documents in full).
 *
 * **Disclosed redesign, matching every other Wave-2 unit's Formik->RHF
 * migration** (see `entities/application-form`'s own doc comments): the
 * baseline reads `resetForm` off Formik's `useFormikContext()`; this app has
 * no Formik dependency. `useFormContext().reset()` is the direct RHF
 * equivalent, read from context so the call signature stays identical to
 * the baseline's `useDiscardApplicationChanges(doOtherResets)`.
 */
export function useDiscardPipelineChanges(doOtherResets?: () => void): {
  readonly discardPipelineChanges: () => void;
} {
  const { reset } = useFormContext();
  const discardPipelineChanges = useCallback(() => {
    reset();
    doOtherResets?.();
  }, [doOtherResets, reset]);
  return { discardPipelineChanges };
}
