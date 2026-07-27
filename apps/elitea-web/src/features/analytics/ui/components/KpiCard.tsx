import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '@/shared/ui/lib/combineSx';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/components/KpiCard.jsx`.
 * A single stat tile: label, big value, optional suffix/badge/subtitle.
 *
 * `label`/`subtitle` are ALREADY-RESOLVED display strings, not raw literals
 * — every call site (`AnalyticsKpiRow`) wraps its own literal through
 * `t()` before passing it down (R-T3), so this component just renders what
 * it is given rather than re-wrapping an opaque runtime string in a second,
 * derived `t()` key.
 */
export interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly valueSuffix?: string;
  readonly subtitle?: string;
  /** Overrides the value's colour (e.g. a status token) when the metric needs attention. */
  readonly color?: string;
  /** Short positive-delta badge, e.g. `↑12%`. */
  readonly badge?: string;
}

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  border: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
});

const labelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
});

const valueSx = (theme: Theme) => ({ color: theme.vars.palette.text.secondary });

const suffixSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.bodyMedium.fontSize,
});

const badgeSx = (theme: Theme) => ({
  color: theme.vars.palette.status.published,
  fontWeight: 600,
  fontSize: theme.typography.labelSmall.fontSize,
});

const subtitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  marginTop: '-0.125rem',
});

function KpiCardImpl({ label, value, valueSuffix, subtitle, color, badge }: KpiCardProps): ReactNode {
  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelSmall"
        sx={labelSx}
      >
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography
          variant="headingMedium"
          sx={combineSx(valueSx, ...(color !== undefined ? [{ color }] : []))}
        >
          {value}
        </Typography>
        {valueSuffix !== undefined && (
          <Typography
            variant="bodySmall"
            sx={suffixSx}
          >
            {valueSuffix}
          </Typography>
        )}
        {badge !== undefined && (
          <Typography
            variant="bodySmall"
            sx={badgeSx}
          >
            {badge}
          </Typography>
        )}
      </Box>
      {subtitle !== undefined && (
        <Typography
          variant="bodySmall"
          sx={subtitleSx}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

export const KpiCard = memo(KpiCardImpl);
