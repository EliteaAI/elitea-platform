import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { ApplicationSaveButton } from '@/entities/application-form';
import { DiscardButton } from '@/shared/ui/DiscardButton';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/toolkits-tab-bar/
 * ToolkitsTabBarPlaceholder.jsx` (Wave-2 unit A4e) — the tab bar shown while
 * a new (not-yet-saved) toolkit is being created, before it has an `id` to
 * edit-save against (`ToolkitsTabBar`'s own `showPlaceholder` branch).
 *
 * DISCLOSED REDESIGN, same shape as `entities/application-form`'s own
 * `CreateApplicationTabBar`/`ApplicationSaveButton` precedent:
 *  - **No `useFormikContext()`/`useDiscardApplicationChanges()`.** This app
 *    has no Formik dependency. The baseline's `useDiscardApplicationChanges`
 *    (`pages/Applications/useDiscardApplicationChanges.js`) is a two-line
 *    `resetForm(); doOtherResets?.()` wrapper — with `resetForm` now the
 *    caller's own react-hook-form instance to own, `onDiscard` IS the full
 *    discard action here (the caller composes its own `form.reset()` +
 *    whatever else it needs into the one callback it passes in).
 *    `isFormDirty` is a required prop for the same reason (`DiscardButton`
 *    already takes `disabled` directly).
 *  - **`SaveApplicationButton` -> `ApplicationSaveButton`.** The baseline's
 *    edit-mode save button is exactly what `entities/application-form`'s
 *    `ApplicationSaveButton` already ported (see that file's own doc
 *    comment — it explicitly cites `SaveApplicationButton.jsx` as one of
 *    its two source files).
 *  - **`TabBarItems` (`pages/Common/Components`) has no `shared/ui`
 *    equivalent yet** — reproduced as a plain flex row, same call
 *    `entities/application-form/ui/CreateApplicationTabBar.tsx`'s own doc
 *    comment already made for this exact baseline component.
 */
export interface ToolkitsTabBarPlaceholderProps {
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly isFormDirty: boolean;
  readonly isSaving?: boolean;
  readonly canSave?: boolean;
}

export function ToolkitsTabBarPlaceholder({
  onSave,
  onDiscard,
  isFormDirty,
  isSaving = false,
  canSave = true,
}: ToolkitsTabBarPlaceholderProps): ReactNode {
  return (
    <Box sx={containerSx}>
      <ApplicationSaveButton
        onSave={onSave}
        disabled={!canSave}
        isSaving={isSaving}
      />
      <DiscardButton
        disabled={!isFormDirty}
        onDiscard={onDiscard}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
});
