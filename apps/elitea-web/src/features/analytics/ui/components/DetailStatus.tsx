import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

/** Loading/empty placeholders shared by the three drill-down detail screens. */

const centeredSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: (theme: Theme) => theme.spacing(8),
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

const emptyTextSx = (theme: Theme) => ({ color: theme.vars.palette.text.metrics });

function DetailLoadingImpl(): ReactNode {
  return (
    <Box sx={centeredSx}>
      <CircularProgress size={32} />
    </Box>
  );
}

function DetailEmptyImpl(): ReactNode {
  return (
    <Box sx={centeredSx}>
      <Typography
        variant="bodyMedium"
        sx={emptyTextSx}
      >
        {t('analytics.detail.noData', 'No data found.')}
      </Typography>
    </Box>
  );
}

export const DetailLoading = memo(DetailLoadingImpl);
export const DetailEmpty = memo(DetailEmptyImpl);
