import { useCallback, useMemo } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import {
  applicationCreationSchema,
  useSaveApplicationVersion,
  type ApplicationCreationInput,
} from '@/entities/application-form';
import type { ApplicationDetail, ApplicationVersionDetail } from '@/shared/api/generated/model';

import { EMPTY_FORM_VALUES, toFormValues, toVersionDraft } from './editPipelineMappers';

export interface EditPipelineFormState {
  readonly form: ReturnType<typeof useForm<ApplicationCreationInput>>;
  readonly handleSave: () => void;
  readonly isSaving: boolean;
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
  const { save, isSaving } = useSaveApplicationVersion(projectId, applicationId, versionId);

  const handleSave = useCallback(() => {
    void form.handleSubmit(async (values) => {
      if (activeVersion === undefined) return;
      const conversationStarters = (values.version_details?.conversation_starters ?? []).filter(
        (entry): entry is string => typeof entry === 'string',
      );
      await save(toVersionDraft(activeVersion, conversationStarters));
    })();
  }, [form, save, activeVersion]);

  return { form, handleSave, isSaving };
}
