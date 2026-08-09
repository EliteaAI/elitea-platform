import { useCallback, useMemo } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import {
  applicationCreationSchema,
  useSaveApplicationVersion,
  type ApplicationCreationInput,
} from '@/entities/application-form';
import { usePipelineGraphDraft } from '@/features/pipelines';
import type { ApplicationDetail, ApplicationVersionDetail } from '@/shared/api/generated/model';

import { EMPTY_FORM_VALUES, toFormValues, toVersionDraft } from './editPipelineMappers';

export interface EditPipelineFormState {
  readonly form: ReturnType<typeof useForm<ApplicationCreationInput>>;
  readonly handleSave: () => void;
  readonly isSaving: boolean;
  /**
   * The most recent save attempt's failure, if any — old app:
   * `useSaveVersion.js:113-116`'s `if (error) { toastError(buildErrorMessage(error)); return false; }`,
   * called from `SaveApplicationButton.jsx`'s `handleSave` on every failed
   * save (network error, validation error, permission error, conflict).
   * Reproduced verbatim from `pages/agents/lib/useEditApplicationForm.ts`'s
   * own `saveError` (Wave-2 unit A1g) — this app has no toast
   * infrastructure (same disclosed gap `SaveToolkitButton.tsx`/
   * `SaveNewVersionButton.tsx` already establish); `useSaveApplicationVersion`'s
   * own `error` state is threaded straight through instead, so the caller
   * (`EditPipeline.tsx`) can render an inline `role="alert"` banner — the
   * same pattern that file already uses for its detail-fetch error.
   * Adversarial-review fix: previously discarded entirely, so a failed save
   * gave the user zero feedback. Cleared automatically at the start of the
   * next save attempt (`useSaveApplicationVersion`'s own `setError(undefined)`).
   */
  readonly saveError: unknown;
}

/**
 * Split out of `EditPipeline.tsx` for the same complexity/line-count budget
 * reasons as `useEditPipelineData` (this same `lib/` directory) — owns the
 * RHF instance, the imperative save action, and their shared dependency on
 * `activeVersion`. Same shape as `pages/agents/lib/useEditApplicationForm.ts`
 * (Wave-2 unit A1g) — `useSaveApplicationVersion` is the same promoted
 * `entities/application-form` mutation both domains share (a Pipeline
 * literally IS an Application row).
 */
export function useEditPipelineForm(
  detail: ApplicationDetail | undefined,
  activeVersion: ApplicationVersionDetail | undefined,
  projectId: string | undefined,
  applicationId: number | undefined,
): EditPipelineFormState {
  const defaultValues = useMemo<ApplicationCreationInput>(
    () => (detail ? toFormValues(detail, activeVersion) : EMPTY_FORM_VALUES),
    [detail, activeVersion],
  );

  const form = useForm<ApplicationCreationInput>({
    resolver: zodResolver(applicationCreationSchema),
    mode: 'onChange',
    values: defaultValues,
  });

  const versionId = activeVersion ? Number(activeVersion.id) : undefined;
  const { save, isSaving, error: saveError } = useSaveApplicationVersion(projectId, applicationId, versionId);
  // #135 (write half): read the flow editor's LIVE graph at click time. This
  // used to submit `toVersionDraft(activeVersion, conversationStarters)` and
  // nothing else — no nodes, no edges, no `pipeline_settings` — so the PUT
  // answered 200 and every graph edit was gone on the next reload.
  const readGraphDraft = usePipelineGraphDraft();

  const handleSave = useCallback(() => {
    void form.handleSubmit(async (values) => {
      if (activeVersion === undefined) return;
      const conversationStarters = (values.version_details?.conversation_starters ?? []).filter(
        (entry): entry is string => typeof entry === 'string',
      );
      const saved = await save(toVersionDraft(activeVersion, conversationStarters, readGraphDraft()));
      /*
       * #133 — the page now arms the app-wide unsaved-changes guard off
       * `formState.isDirty`, so a successful save must clear that dirtiness
       * or the next nav-away is prompted about changes already persisted.
       * `useSaveApplicationVersion` invalidates no GET-side cache by design
       * (its own doc comment), so the `values` prop feeding `useForm` above
       * never changes and RHF has no other reason to reset. Left dirty on
       * failure — those edits really are still unsaved.
       */
      if (saved !== undefined) form.reset(form.getValues());
    })();
  }, [form, save, activeVersion, readGraphDraft]);

  return { form, handleSave, isSaving, saveError };
}
