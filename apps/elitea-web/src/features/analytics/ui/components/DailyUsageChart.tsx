import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import { numField, strField } from '../../lib/looseRecord';
import { ChartTooltip } from './ChartTooltip';

/**
 * The "primary metric vs. errors, per day" area chart shared by
 * `AnalyticsAgentDetailed`/`AnalyticsToolDetailed` (baseline: each file's
 * own near-identical `daily_usage` chart, `events`/`calls` on the left
 * axis, `errors` on the right). `rows` are `AnalyticsDetailEnvelope.
 * daily_usage` — a `zod.looseObject({})` array the Go handler always
 * returns empty today (see `lib/looseRecord.ts`'s header), read
 * defensively for forward compatibility.
 */
export interface DailyUsageChartProps {
  readonly title: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** Wire field name for the primary series, e.g. `'events'`/`'calls'`. */
  readonly primaryKey: string;
  readonly primaryLabel: string;
  readonly errorsLabel: string;
}

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

const titleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
  display: 'block',
});

function DailyUsageChartImpl({ title, rows, primaryKey, primaryLabel, errorsLabel }: DailyUsageChartProps): ReactNode {
  const theme = useTheme();
  const axisStroke = theme.vars.palette.text.primary;
  const axisTickStyle = { fill: axisStroke, fontSize: theme.typography.labelSmall.fontSize };

  const points = useMemo(
    () =>
      rows.map((row) => ({
        date: strField(row, 'date'),
        primary: numField(row, primaryKey),
        errors: numField(row, 'errors'),
      })),
    [rows, primaryKey],
  );

  if (points.length === 0) return null;

  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {title}
      </Typography>
      <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
        <ResponsiveContainer
          width="100%"
          height={200}
        >
          <AreaChart data={points}>
            <XAxis
              dataKey="date"
              tick={axisTickStyle}
              tickFormatter={(value: string) => value.slice(5)}
              axisLine={{ stroke: axisStroke }}
              tickLine={{ stroke: axisStroke }}
            />
            <YAxis
              yAxisId="primary"
              tick={axisTickStyle}
              axisLine={{ stroke: axisStroke }}
              tickLine={{ stroke: axisStroke }}
            />
            <YAxis
              yAxisId="errors"
              orientation="right"
              tick={axisTickStyle}
              axisLine={{ stroke: axisStroke }}
              tickLine={{ stroke: axisStroke }}
            />
            <RechartsTooltip content={<ChartTooltip />} />
            <Area
              yAxisId="primary"
              type="monotone"
              dataKey="primary"
              name={primaryLabel}
              stroke={theme.vars.palette.status.draft}
              fill={theme.vars.palette.status.draft}
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Area
              yAxisId="errors"
              type="monotone"
              dataKey="errors"
              name={errorsLabel}
              stroke={theme.vars.palette.status.rejected}
              fill={theme.vars.palette.status.rejected}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

export const DailyUsageChart = memo(DailyUsageChartImpl);
