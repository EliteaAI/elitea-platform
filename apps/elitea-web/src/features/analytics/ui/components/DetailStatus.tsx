import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { noDataSourceOf } from '../../lib/noDataSource';

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

const unavailableSx: SxProps<Theme> = {
  flexDirection: 'column',
  gap: (theme: Theme) => theme.spacing(1),
  maxWidth: '32rem',
  textAlign: 'center',
};

const detailSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  opacity: 0.8,
});

export interface AnalyticsLoadErrorProps {
  /**
   * The rejection the query produced. Optional so a caller with no error in
   * hand still renders the generic failure — a missing error must not be read
   * as "the feature is absent", which is the stronger of the two claims.
   */
  readonly error?: unknown;
}

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
 * The load-failure branch, which is now TWO branches.
 *
 * The routes used to fail as a unit — one absent data source behind all four
 * (issue #303) — and this component said so with one string. That stopped being
 * true when the gateway request log (shared migration 0099) gave the Overview
 * and Users tabs a real producer: Agents and Tools still have none, and answer
 * 501 `{code: "no_data_source"}` with the reason, while a genuine query failure
 * anywhere still answers 500.
 *
 * Saying "Failed to load analytics data." to both is a real cost, not a
 * cosmetic one. A user reading it on the Agents tab has no way to tell a broken
 * deployment from a feature this platform does not have, so the honest outcomes
 * are to file a bug that will be closed as working-as-intended, or to keep
 * reloading a page that will never fill in. The backend sends the distinction
 * and its own explanation; this renders them.
 */
function AnalyticsLoadErrorImpl({ error }: AnalyticsLoadErrorProps): ReactNode {
  const absent = noDataSourceOf(error);
  if (absent === undefined) {
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

  return (
    <Box sx={combineSx(centeredSx, unavailableSx)}>
      <Typography
        variant="bodyMedium"
        sx={emptyTextSx}
      >
        {t('analytics.unavailable.title', 'Not available on this deployment')}
      </Typography>
      {absent.detail !== '' && (
        // The server's own words, rather than a paraphrase this file would have
        // to keep in step with a repository it cannot see. It names the table
        // or the figure that is missing, which is the only thing that makes
        // this screen actionable for an operator.
        <Typography
          variant="bodySmall"
          sx={detailSx}
        >
          {absent.detail}
        </Typography>
      )}
    </Box>
  );
}

export const DetailLoading = memo(DetailLoadingImpl);
export const DetailEmpty = memo(DetailEmptyImpl);
export const AnalyticsLoadError = memo(AnalyticsLoadErrorImpl);
