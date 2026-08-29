import type { ReactNode } from 'react';

import { CreateApplicationTabBar } from '@/entities/application-form';

import { useDiscardPipelineChanges } from '../useDiscardPipelineChanges';

export interface EditPipelineSaveBarProps {
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly isSaving: boolean;
  /**
   * Runs AFTER the form reset when the user confirms the discard dialog —
   * threaded into `useDiscardPipelineChanges`'s `doOtherResets`. The page
   * uses it to actually drop the rest of the draft: the flow-editor stores
   * (`resetPipelineDraft`) and the model pick (`llmSettings.reset`), which
   * `form.reset()` cannot see, then disarm the nav blocker and leave for the
   * list. Measured defect (the pipelines twin of the agents page's fix in
   * `pages/agents/ui/EditApplicationSaveBar.tsx`): Discard reverted only the
   * RHF fields while the save path kept reading the LIVE graph through
   * `usePipelineGraphDraft()`, so a later Save silently PERSISTED the
   * discarded canvas/model edits — and the user was still on the edit page
   * with no way out.
   */
  readonly onDiscarded?: (() => void) | undefined;
}

/**
 * The pipeline editor's Save/Discard bar. Split out of `EditPipeline.tsx`
 * (mirroring `pages/agents/ui/EditApplicationSaveBar.tsx`) so that
 * `useDiscardPipelineChanges` — this unit's own `useFormContext()`-based hook
 * — is called from a genuine `<FormProvider>` DESCENDANT: `EditPipeline`
 * both creates the `form` instance and renders the provider, so it sits
 * ABOVE that provider in the tree and calling a context-reading hook there
 * directly would throw. Also frees `EditPipeline.tsx` room under the §3.5
 * 400-line budget for the discard/chat wiring it gained.
 */
export function EditPipelineSaveBar({ onSave, canSave, isSaving, onDiscarded }: EditPipelineSaveBarProps): ReactNode {
  const { discardPipelineChanges } = useDiscardPipelineChanges(onDiscarded);
  return (
    <CreateApplicationTabBar
      onSave={onSave}
      onCancel={discardPipelineChanges}
      canSave={canSave}
      isSaving={isSaving}
      cancelDisabled={isSaving}
      saveTestId="pipeline-save-button"
    />
  );
}
