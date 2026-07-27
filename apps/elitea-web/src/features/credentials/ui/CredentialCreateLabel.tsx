/**
 * ui/CredentialCreateLabel.tsx — the "Create new … credentials" option label
 * inside `CredentialsSelect`'s create-action row. Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-select/CredentialCreateLabel.jsx`.
 */
import type { ReactNode } from 'react';

import PersonIcon from '@mui/icons-material/Person';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BriefcaseIcon } from '@/shared/ui/icons/briefcase-icon';

export interface CredentialCreateLabelProps {
  readonly isPrivate: boolean;
  readonly type?: string;
}

export function CredentialCreateLabel({ isPrivate, type }: CredentialCreateLabelProps): ReactNode {
  const scope = isPrivate
    ? t('credentials.createLabel.private', 'private')
    : t('credentials.createLabel.project', 'project');
  const typePrefix = type ? `${type} ` : '';

  return (
    <Box
      component="span"
      sx={containerSx}
    >
      {isPrivate ? <PersonIcon fontSize="inherit" /> : <BriefcaseIcon />}
      {t('credentials.createLabel.text', 'New {{scope}} {{typePrefix}}credentials', { scope, typePrefix })}
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: theme.spacing(1),
});
