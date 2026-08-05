/**
 * ui/CredentialNotFoundValue.tsx — the `CredentialsSelect` selected-value
 * display when the current `elitea_title` matches no loaded option. Ported
 * from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-select/CredentialNotFoundValue.jsx`.
 * Manifest COPY-112.
 */
import type { ReactNode } from 'react';

import PersonIcon from '@mui/icons-material/Person';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { BriefcaseIcon } from '@/shared/ui/icons/briefcase-icon';

export interface CredentialNotFoundValueProps {
  readonly eliteaTitle: string;
  readonly isPrivate?: boolean;
  readonly hasFetchedData: boolean;
}

export function CredentialNotFoundValue({ eliteaTitle, isPrivate, hasFetchedData }: CredentialNotFoundValueProps): ReactNode {
  const notFoundLabel = t('credentials.notFoundValue.tooltip', 'Credential not found');

  return (
    <Box sx={containerSx(hasFetchedData)}>
      {isPrivate ? <PersonIcon fontSize="inherit" /> : <BriefcaseIcon />}
      <Typography
        variant="labelMedium"
        sx={textSx(hasFetchedData)}
      >
        {eliteaTitle}
      </Typography>
      {hasFetchedData && (
        <Tooltip
          title={notFoundLabel}
          placement="top"
        >
          <Box sx={attentionIconBoxSx}>
            <AttentionIcon />
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}

const containerSx = (mismatch: boolean): SxProps<Theme> => (theme: Theme) => ({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  color: mismatch ? theme.vars.palette.status.rejected : theme.vars.palette.text.secondary,
});

const textSx = (mismatch: boolean): SxProps<Theme> => (theme: Theme) => ({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: mismatch ? theme.vars.palette.status.rejected : theme.vars.palette.text.disabled,
});

const attentionIconBoxSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  width: '1rem',
  height: '1rem',
  color: theme.vars.palette.icon.fill.attention,
  '& svg': { width: '0.875rem', height: '0.875rem' },
});
