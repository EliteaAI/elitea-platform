import { type ReactNode, useCallback, useMemo } from 'react';

import CircularProgress from '@mui/material/CircularProgress';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

import type { ToolkitWriteBody, ToolkitWriteResult, UseToolkitCreateMutation } from '../api/toolkits';
import { toolkitNameSettingsKey, type ToolSchemaLike } from './SaveToolkitButton';

export interface CreateToolkitFormValues {
  readonly type?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/** @public */
export interface CreateToolkitButtonProps {
  readonly toolSchema: ToolSchemaLike | undefined;
  readonly values: CreateToolkitFormValues;
  readonly isDirty: boolean;
  readonly hasErrors: boolean;
  readonly triggerValidation?: (() => void) | undefined;
  readonly projectId: string | undefined;
  readonly onToolkitCreated?: ((result: ToolkitWriteResult) => void) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  /** No generated `POST /elitea_core/tools/prompt_lib/{projectId}` endpoint exists yet — see `../api/toolkits.ts`'s module doc comment. Injected so a future caller can wire the real mutation once one exists. */
  readonly createToolkit: UseToolkitCreateMutation;
  readonly isCreating?: boolean | undefined;
}

/** The resolved `name` + create-mutation body, split out of `onCreateToolkit` purely to keep `CreateToolkitButton` under the oxlint complexity budget. */
function buildCreateBody(values: CreateToolkitFormValues, type: string, toolSchema: ToolSchemaLike | undefined): ToolkitWriteBody {
  const toolkitNameKey = toolkitNameSettingsKey(toolSchema);
  const name = toolkitNameKey !== undefined ? ((values.settings?.[toolkitNameKey] as string | undefined) ?? values.name) : values.name;

  return {
    type,
    ...(name !== undefined ? { name } : {}),
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.settings !== undefined ? { settings: values.settings } : {}),
    ...(values.meta !== undefined ? { meta: values.meta } : {}),
  };
}

/**
 * Ported from `apps/elitea-ui/src/pages/NewChat/components/
 * CreateToolkitButton.jsx`.
 *
 * DISCLOSED DEVIATIONS: same shape `SaveToolkitButton.tsx` (this same unit)
 * already establishes — no ambient Formik context (`values`/`isDirty`
 * explicit props), `useToolkitCreateMutation` injected (no generated POST
 * endpoint), no toast (`onToolkitCreated`/`onError` callbacks instead).
 */
export function CreateToolkitButton({
  toolSchema,
  values,
  isDirty,
  hasErrors,
  triggerValidation,
  projectId,
  onToolkitCreated,
  onError,
  createToolkit,
  isCreating = false,
}: CreateToolkitButtonProps): ReactNode {
  const onCreateToolkit = useCallback(async () => {
    if (hasErrors) {
      triggerValidation?.();
      return;
    }
    const { type } = values;
    if (projectId === undefined || type === undefined) return;

    try {
      const result = await createToolkit({ projectId, ...buildCreateBody(values, type, toolSchema) });
      onToolkitCreated?.(result);
    } catch (error) {
      onError?.(error);
    }
  }, [hasErrors, triggerValidation, projectId, values, toolSchema, createToolkit, onToolkitCreated, onError]);

  const shouldDisableSave = useMemo(() => isCreating || !isDirty || values.type === undefined, [isCreating, isDirty, values.type]);

  return (
    <BaseBtn
      disabled={shouldDisableSave}
      variant="elitea"
      color="primary"
      onClick={() => {
        void onCreateToolkit();
      }}
    >
      {isCreating && <CircularProgress size={16} />}
      {t('toolkits.createToolkitButton.label', 'Create')}
    </BaseBtn>
  );
}
