/**
 * ui/CredentialsControls.tsx — the kebab-menu control cluster on a
 * credential's edit screen: Delete (with typed confirmation). Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-tab-bar/CredentialsControls.jsx`.
 * Manifest COPY-114, PERM-021.
 *
 * DISCLOSED SCOPE REDUCTION (forced by ownership boundary, see this unit's
 * final report): the baseline's Pin/unpin menu item
 * (`widgets/pin-toggler`'s `usePin`/`usePinMenu`) is dropped — that widget
 * slice is cross-domain and out of this unit's ownership fence (R-L1:
 * `features/credentials` may not import `widgets/pin-toggler`). Only
 * Delete is ported. Permission gating (`checkPermission(PERMISSIONS
 * .configuration.delete)`) and the "last remaining vectorstorage/embedding
 * config" guard are both caller-computed (`canDelete`/`deleteDisabledReason`)
 * rather than read from a `useCheckPermission()`/RTK-Query hook this slice
 * has no access to yet — see `../lib` for the permission-string constants
 * (`@/shared/lib/permissions`) a caller wires this from.
 */
import { useState, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { ControlsDropdown } from '@/shared/ui/ControlsDropdown';
import type { ControlsDropdownItem } from '@/shared/ui/ControlsDropdown';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

export interface CredentialsControlsProps {
  readonly credentialName: string;
  readonly canDelete: boolean;
  readonly isDeleting?: boolean;
  readonly deleteDisabledReason?: string;
  readonly onDelete: () => void;
}

export function CredentialsControls({ credentialName, canDelete, isDeleting = false, deleteDisabledReason, onDelete }: CredentialsControlsProps): ReactNode {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const items: ControlsDropdownItem[] = [
    {
      key: 'delete-credential',
      label: t('credentials.controls.delete', 'Delete'),
      disabled: isDeleting || !canDelete,
      onClick: () => {
        setConfirmOpen(true);
      },
    },
  ];

  const menu = (
    <ControlsDropdown
      items={items}
      triggerAriaLabel={t('credentials.controls.menuLabel', 'Credential actions')}
    />
  );

  return (
    <Box sx={wrapperSx}>
      {!canDelete && deleteDisabledReason ? (
        <Tooltip title={deleteDisabledReason}>
          <Box component="span">{menu}</Box>
        </Tooltip>
      ) : (
        menu
      )}
      <DeleteEntityModal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
        name={credentialName}
        shouldRequestInputName
        confirming={isDeleting}
      />
    </Box>
  );
}

const wrapperSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  position: 'relative',
  alignItems: 'center',
  paddingLeft: theme.spacing(1),
  '&::before': {
    content: '""',
    position: 'absolute',
    left: 0,
    top: theme.spacing(0.5),
    bottom: theme.spacing(0.5),
    borderLeft: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  },
});
