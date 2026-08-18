import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

/**
 * Loading/empty/error placeholders shared by the analytics screens:
 * `DetailLoading`/`DetailEmpty` by the three drill-down detail screens,
 * `AnalyticsLoadError` by every screen whose own query can fail
 * (`AnalyticsTabContent`'s overview branch plus the three list tabs).
 */

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

/**
 * The load-failure branch. Reuses `analytics.overview.loadError` verbatim —
 * the analytics routes fail as a unit (they share one absent data source,
 * issue #303), so a per-tab wording would claim a distinction the backend
 * does not make, and the string is already the one users see on Overview.
 */
function AnalyticsLoadErrorImpl(): ReactNode {
  return (
    <Box sx={centeredSx}>
      <Typography
        variant="bodyMedium"
        sx={emptyTextSx}
      >
        {t('analytics.overview.loadError', 'Failed to load analytics data.')}
      </Typography>
    </Box>
  );
}

export const DetailLoading = memo(DetailLoadingImpl);
export const DetailEmpty = memo(DetailEmptyImpl);
export const AnalyticsLoadError = memo(AnalyticsLoadErrorImpl);
