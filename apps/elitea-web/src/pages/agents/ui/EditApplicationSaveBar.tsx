import type { ReactNode } from 'react';

import { CreateApplicationTabBar } from '@/entities/application-form';

import { useDiscardApplicationChanges } from '../useDiscardApplicationChanges';

export interface EditApplicationSaveBarProps {
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly isSaving: boolean;
}

/**
 * The agent editor's Save/Discard bar.
 *
 * It is its own component so that `useDiscardApplicationChanges` (this
 * unit's `useFormContext()`-based hook) is called from a genuine
 * `<FormProvider>` DESCENDANT: `EditApplication` both creates the `form`
 * instance and renders the provider, so it sits ABOVE that provider in the
 * tree and calling a context-reading hook there directly would throw
 * ("useFormContext must be used within <FormProvider>"). This is also the
 * hook's real home in the baseline, where `ApplicationTabBar` — a sibling
 * component, for exactly the same reason — is its only caller.
 *
 * Moved out of `EditApplication.tsx` (which sat at 399 of the §3.5 400-line
 * budget) to make room for the model picker, alongside the two components
 * that page already keeps in this directory.
 */
export function EditApplicationSaveBar({ onSave, canSave, isSaving }: EditApplicationSaveBarProps): ReactNode {
  const { discardApplicationChanges } = useDiscardApplicationChanges();
  return (
    <CreateApplicationTabBar
      onSave={onSave}
      onCancel={discardApplicationChanges}
      canSave={canSave}
      isSaving={isSaving}
      cancelDisabled={isSaving}
    />
  );
}
