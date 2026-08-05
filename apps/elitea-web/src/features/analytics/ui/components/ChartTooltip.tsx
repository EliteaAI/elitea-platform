import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { fmtNum } from '@/features/analytics/lib/format';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/components/ChartTooltip.jsx`
 * — a `recharts` custom `<Tooltip content={...}>` renderer shared by every
 * area/bar chart in this feature.
 */
interface ChartTooltipPayloadEntry {
  readonly name?: string | number;
  readonly value?: string | number | readonly (string | number)[];
  readonly color?: string;
}

export interface ChartTooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly ChartTooltipPayloadEntry[];
  readonly label?: string | number;
}

const wrapperSx = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderRadius: theme.vars.shape.radiusSm,
  backgroundColor: theme.vars.palette.background.secondary,
  border: `1px solid ${theme.vars.palette.border.table}`,
});

const labelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
});

function ChartTooltipImpl({ active, payload, label }: ChartTooltipProps): ReactNode {
  if (active !== true || payload === undefined || payload.length === 0) return null;

  return (
    <Box sx={wrapperSx}>
      <Typography
        variant="labelSmall"
        sx={labelSx}
      >
        {label}
      </Typography>
      {payload.map((entry, index) => (
        <Typography
          key={`${String(entry.name)}-${index}`}
          variant="bodySmall"
          sx={{ color: entry.color }}
        >
          {entry.name}: {typeof entry.value === 'number' ? fmtNum(entry.value) : entry.value}
        </Typography>
      ))}
    </Box>
  );
}

export const ChartTooltip = memo(ChartTooltipImpl);
