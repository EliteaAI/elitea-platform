import { useCallback, useMemo } from 'react';

import { useWatch, type UseFormReturn } from 'react-hook-form';

import type { ApplicationCreationInput } from '@/entities/application-form';
import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

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
  activeVersion: ApplicationVersionDetail | undefined,
): EditApplicationEditorBridge {
  const name = useWatch({ control: form.control, name: 'name' }) ?? '';
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';

  const values = useMemo(
    () => ({
      name,
      description,
      version_details: {
        instructions: activeVersion?.instructions ?? '',
        welcome_message: activeVersion?.welcome_message ?? '',
        variables: [],
        meta: { step_limit: undefined },
      },
    }),
    [name, description, activeVersion],
  );

  /*
   * Only `name`/`description` are routed back into the form: those are the two
   * fields `applicationCreationSchema` validates and the two the Save button is
   * gated on. The version-level fields `CreateAgentForm` also renders are
   * display-only here — `useEditApplicationForm` persists
   * `conversation_starters` alone (see that hook, and this page's doc comment on
   * the ApplicationUpdateRequest gap). Routing them into the form would imply a
   * save path that does not exist.
   */
  const onFieldChange = useCallback(
    (path: string, value: unknown) => {
      if (path !== 'name' && path !== 'description') return;
      form.setValue(path, typeof value === 'string' ? value : '', { shouldValidate: true, shouldDirty: true });
    },
    [form],
  );

  return { values, onFieldChange };
}
