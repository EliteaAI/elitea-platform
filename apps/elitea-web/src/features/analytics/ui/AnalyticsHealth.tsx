import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { EVENT_TYPE_COLORS } from '../lib/constants';
import { fmtDuration, fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { ChartTooltip } from './components/ChartTooltip';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsHealth.jsx`.
 *
 * `health`/`dailyActivity` are genuinely unknown-shaped rows (see
 * `lib/looseRecord.ts`'s header) — `ProjectAnalytics` (the only response
 * `AnalyticsContainer` can source this from) has NO `health` field at all
 * (`src/shared/api/generated/model/projectAnalytics.zod.ts`:
 * `kpis`/`top_ai_users`/`daily_activity`/`models`, nothing else;
 * `internal/api/v2/analytics/handler.go`'s `Usage()` never writes a
 * `"health"` key). `health` is therefore always empty against the real
 * backend today, exactly as in the baseline (whose own `AnalyticsContainer`
 * passed `data.health` — a key that was never in ITS API response either).
 * This tab's "No health data available." empty state is consequently the
 * ALWAYS-observable state right now, faithfully reproduced rather than
 * hidden — a pre-existing baseline limitation, not a porting regression.
 */
export interface AnalyticsHealthProps {
  readonly health?: readonly Readonly<Record<string, unknown>>[];
  readonly dailyActivity?: readonly Readonly<Record<string, unknown>>[];
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

const subtitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  marginBottom: theme.spacing(1),
  display: 'block',
});

const emptyStateSx = (theme: Theme) => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: theme.spacing(8),
});

const emptyTextSx = (theme: Theme) => ({ color: theme.vars.palette.text.metrics });

const headerRowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
});

const headerCellSx = (theme: Theme) => ({
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 600,
  color: theme.vars.palette.text.metrics,
  textTransform: 'uppercase',
});

const rowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
  '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover },
});

const cellValueSx = (theme: Theme) => ({
  fontSize: theme.typography.bodyMedium.fontSize,
  color: theme.vars.palette.text.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

interface ErrorTrendPoint {
  readonly date: string;
  readonly errors: number;
  readonly events: number;
}

/**
 * `health.map(...)` read `strField`/`numField` calls directly inside JSX in
 * an earlier draft — `i18next/no-literal-string` (R-T3, `mode: "jsx-only"`)
 * flags a raw string LITERAL ARGUMENT to any non-`t`/`i18n` callee found
 * anywhere inside a JSX subtree, not only JSX text/attribute positions, so
 * `strField(row, 'event_type')` written inline in the returned JSX tripped
 * it even though `'event_type'` is a wire field name, not user-visible copy.
 * Every other loose-row transform in this feature (`errorTrend` right
 * below, `AnalyticsOverview`'s `dailyActivity`/`topAiUsers`) already does
 * this extraction in a `useMemo` BEFORE the `return`, outside any JSX —
 * this interface/derivation follows the same, already-established pattern.
 */
interface HealthRow {
  readonly eventType: string;
  readonly total: number;
  readonly errors: number;
  readonly errorRatePercent: number;
  readonly avgDurationMs: number;
}

function AnalyticsHealthImpl({ health = [], dailyActivity = [] }: AnalyticsHealthProps): ReactNode {
  const theme = useTheme();
  const axisStroke = theme.vars.palette.text.primary;
  const axisTickStyle = { fill: axisStroke, fontSize: theme.typography.labelSmall.fontSize };

  const errorTrend = useMemo<ErrorTrendPoint[]>(
    () =>
      dailyActivity.map((point) => ({
        date: strField(point, 'date'),
        errors: numField(point, 'errors'),
        events: numField(point, 'events'),
      })),
    [dailyActivity],
  );

  const healthRows = useMemo<HealthRow[]>(
    () =>
      health.map((row) => ({
        eventType: strField(row, 'event_type'),
        total: numField(row, 'total'),
        errors: numField(row, 'errors'),
        // `error_rate` is a 0-1 fraction (same field family as
        // `AgentAnalytics.error_rate`/`ToolAnalytics.error_rate`,
        // `internal/domain/analytics/types.go:22-37`; `health` rows
        // themselves have no formal schema — see this file's header
        // comment — but the backend never emits `health` today, so this
        // is forward-looking parity with the sibling tabs), not a 0-100
        // percentage — must be scaled ×100 for display/threshold
        // comparisons, matching this feature's other fraction→percent
        // readouts (e.g. `ModelUsageTable.tsx`'s `share.toFixed(1)}%`,
        // and the already-fixed `AnalyticsAgents.tsx`/`AnalyticsTools.tsx`
        // `errorRatePercent` handling). Previously stored and compared/
        // rendered the raw fraction directly, so the `> 5` "unhealthy"
        // threshold could never trigger and a real 20% error rate
        // displayed as "0.2%".
        errorRatePercent: numField(row, 'error_rate') * 100,
        avgDurationMs: numField(row, 'avg_duration_ms'),
      })),
    [health],
  );

  if (health.length === 0) {
    return (
      <Box sx={emptyStateSx}>
        <Typography
          variant="bodyMedium"
          sx={emptyTextSx}
        >
          {t('analytics.health.empty', 'No health data available.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }}>
      {errorTrend.length > 0 && (
        <Box sx={cardSx}>
          <Typography
            variant="labelMedium"
            sx={titleSx}
          >
            {t('analytics.health.chartTitle', 'Requests vs Errors')}
          </Typography>
          <Typography
            variant="bodySmall"
            sx={subtitleSx}
          >
            {t('analytics.health.chartSubtitle', 'Total requests trend with error overlay')}
          </Typography>
          <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
            <ResponsiveContainer
              width="100%"
              height={240}
            >
              <AreaChart data={errorTrend}>
                <XAxis
                  dataKey="date"
                  tick={axisTickStyle}
                  tickFormatter={(value: string) => value.slice(5)}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={{ stroke: axisStroke }}
                />
                <YAxis
                  yAxisId="events"
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
                  yAxisId="events"
                  type="monotone"
                  dataKey="events"
                  name={t('analytics.health.seriesTotalRequests', 'Total Requests')}
                  stroke={theme.vars.palette.status.draft}
                  fill={theme.vars.palette.status.draft}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  yAxisId="errors"
                  type="monotone"
                  dataKey="errors"
                  name={t('analytics.health.seriesErrors', 'Errors')}
                  stroke={theme.vars.palette.status.rejected}
                  fill={theme.vars.palette.status.rejected}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
      <Box sx={cardSx}>
        <Typography
          variant="labelMedium"
          sx={titleSx}
        >
          {t('analytics.health.tableTitle', 'Health by Event Type')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
          <Box sx={headerRowSx}>
            <Typography sx={combineSx(headerCellSx, { flex: 2 })}>
              {t('analytics.health.columnEventType', 'Event Type')}
            </Typography>
            <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
              {t('analytics.health.columnTotal', 'Total')}
            </Typography>
            <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
              {t('analytics.health.columnErrors', 'Errors')}
            </Typography>
            <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
              {t('analytics.health.columnErrorRate', 'Error Rate')}
            </Typography>
            <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
              {t('analytics.health.columnAvgLatency', 'Avg Latency')}
            </Typography>
          </Box>
          {healthRows.map((row, index) => (
            <Box
              key={`${row.eventType}-${index}`}
              sx={rowSx}
            >
              <Box sx={combineSx(cellValueSx, { flex: 2, display: 'flex', alignItems: 'center', gap: 1 })}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: theme.vars.shape.radiusPill,
                    backgroundColor: EVENT_TYPE_COLORS[row.eventType] ?? theme.vars.palette.status.draft,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="bodySmall">{row.eventType}</Typography>
              </Box>
              <Typography sx={combineSx(cellValueSx, { flex: 1 })}>{fmtNum(row.total)}</Typography>
              <Typography
                sx={combineSx(cellValueSx, {
                  flex: 1,
                  color: row.errors > 0 ? theme.vars.palette.status.rejected : undefined,
                })}
              >
                {row.errors}
              </Typography>
              <Typography
                sx={combineSx(cellValueSx, {
                  flex: 1,
                  color: row.errorRatePercent > 5 ? theme.vars.palette.status.rejected : undefined,
                })}
              >
                {row.errorRatePercent.toFixed(1)}%
              </Typography>
              <Typography sx={combineSx(cellValueSx, { flex: 1 })}>{fmtDuration(row.avgDurationMs)}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export const AnalyticsHealth = memo(AnalyticsHealthImpl);
