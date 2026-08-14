import { useCallback, useMemo } from 'react';

import { useWatch, type UseFormReturn } from 'react-hook-form';

import type { ApplicationCreationInput } from '@/entities/application-form';

import type { EditApplicationVersionFieldsState } from './useEditApplicationVersionFields';

/**
 * Bridges `EditApplication`'s RHF form to `CreateAgentForm`'s plain
 * `values`/`onFieldChange` prop shape — the same adapter
 * `pages/agents/CreateApplication.tsx` writes inline, extracted here because
 * `EditApplication` is at its §3.5 cyclomatic-complexity budget (12) and this
 * file's own header already establishes `./lib/` as where that page's hooks go.
 *
 * `useWatch`, NOT `form.watch(...)`: this page feeds `useForm({ values })` and
 * the values arrive asynchronously, after the agent detail resolves. Reading
 * `form.watch()` in the render body did not pick that up — the page re-rendered
 * (its heading showed the agent's name) and `formState.isValid` flipped true
 * (Save became enabled), proving the form held the values, while `watch()` still
 * returned `''` and the inputs rendered blank. `useWatch` subscribes to the
 * control and re-renders on the change.
 */
export interface EditApplicationEditorBridge {
  readonly values: {
    readonly name: string;
    readonly description: string;
    readonly version_details: {
      readonly instructions: string;
      readonly welcome_message: string;
      readonly variables: readonly { readonly name: string; readonly value: string }[];
      readonly meta: { readonly step_limit: number | undefined };
    };
  };
  readonly onFieldChange: (path: string, value: unknown) => void;
}

export function useEditApplicationEditorBridge(
  form: UseFormReturn<ApplicationCreationInput>,
  versionFields: EditApplicationVersionFieldsState,
): EditApplicationEditorBridge {
  const name = useWatch({ control: form.control, name: 'name' }) ?? '';
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';

  const { fields, applyFieldChange } = versionFields;

  const values = useMemo(
    () => ({
      name,
      description,
      version_details: {
        instructions: fields.instructions,
        welcome_message: fields.welcomeMessage,
        variables: fields.variables,
        meta: { step_limit: fields.stepLimit },
      },
    }),
    [name, description, fields],
  );

  /*
   * #307 — this used to `return` for every path except `name`/`description`,
   * so instructions, the welcome message, the variables and the step limit
   * were rendered from the server response and then discarded on every
   * keystroke. They now go to `useEditApplicationVersionFields`, which holds
   * them outside the RHF form (they are not in `applicationCreationSchema`)
   * and hands them to `useEditApplicationForm`'s save payload.
   *
   * `name`/`description` still go through RHF: they are the two fields the
   * schema validates and the two the Save button's `formState.isValid` gate
   * reads.
   */
  const onFieldChange = useCallback(
    (path: string, value: unknown) => {
      if (applyFieldChange(path, value)) return;
      if (path !== 'name' && path !== 'description') return;
      form.setValue(path, typeof value === 'string' ? value : '', { shouldValidate: true, shouldDirty: true });
    },
    [form, applyFieldChange],
  );

  return { values, onFieldChange };
}
