import { useCallback } from 'react';

import { useFormContext } from 'react-hook-form';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/
 * useDiscardApplicationChanges.js` — resets the in-progress
 * create/edit-application form back to its last-saved values, invoked by
 * `CreateApplication.tsx`/`EditApplication.tsx`'s discard action (this
 * unit).
 *
 * **Disclosed redesign, matching every other Wave-2 unit's Formik->RHF
 * migration (see `entities/application-form`'s own doc comments):** the
 * baseline reads `resetForm` off Formik's `useFormikContext()`; this app
 * has no Formik dependency (`package.json` — `react-hook-form` is the only
 * form library). `useFormContext().reset()` is the direct RHF equivalent —
 * same "reset the currently-active form back to its defaultValues" contract
 * — read from context rather than passed as a prop so the call signature
 * stays identical to the baseline's `useDiscardApplicationChanges(doOtherResets)`.
 */
export function useDiscardApplicationChanges(doOtherResets?: () => void): {
  readonly discardApplicationChanges: () => void;
} {
  const { reset } = useFormContext();
  const discardApplicationChanges = useCallback(() => {
    reset();
    doOtherResets?.();
  }, [doOtherResets, reset]);
  return { discardApplicationChanges };
}
