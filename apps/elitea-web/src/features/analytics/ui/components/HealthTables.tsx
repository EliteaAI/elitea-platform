import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { AnalyticsHealth as AnalyticsHealthData } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { pickChartColor } from '../../lib/constants';
import { fmtDuration, fmtNum } from '../../lib/format';

/**
 * The Health tab's two tables. Extracted from `AnalyticsHealth.tsx` purely to
 * bring that file under the 400-line budget; they are only ever rendered there.
 */

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

export interface HealthTableProps {
  readonly health: AnalyticsHealthData;
}
/** The failure breakdown, by the gateway's own classification. */
export function ErrorCodeTable({ health }: HealthTableProps): ReactNode {
  const theme = useTheme();
  if (health.by_error_code.length === 0) return null;
  return (
    <Box sx={cardSx}>
      <Typography variant="labelMedium" sx={titleSx}>
        {t('analytics.health.errorCodeTitle', 'Failures by Classification')}
      </Typography>
      <Typography variant="bodySmall" sx={subtitleSx}>
        {t(
          'analytics.health.errorCodeSubtitle',
          'The gateway assigns these; no upstream error text is ever stored',
        )}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
        <Box sx={headerRowSx}>
          <Typography sx={combineSx(headerCellSx, { flex: 3 })}>
            {t('analytics.health.columnErrorCode', 'Classification')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1, textAlign: 'right' })}>
            {t('analytics.health.columnRequests', 'Requests')}
          </Typography>
        </Box>
        {health.by_error_code.map((row) => (
          <Box key={row.error_code} sx={rowSx}>
            <Typography sx={combineSx(cellValueSx, { flex: 3, color: theme.vars.palette.status.rejected })}>
              {row.error_code}
            </Typography>
            <Typography sx={combineSx(cellValueSx, { flex: 1, textAlign: 'right' })}>
              {fmtNum(row.requests)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Reliability and latency per model.
 *
 * The STREAMED column is not decoration: the rows are keyed by it, because a
 * streamed duration is the whole stream — seconds where a buffered call is
 * milliseconds — and merging them yields a mean that describes neither. Without
 * the column the table would look like it had duplicate rows.
 */
export function ModelHealthTable({ health }: HealthTableProps): ReactNode {
  const theme = useTheme();
  if (health.by_model.length === 0) return null;
  return (
    <Box sx={cardSx}>
      <Typography variant="labelMedium" sx={titleSx}>
        {t('analytics.health.tableTitle', 'Health by Model')}
      </Typography>
      <Typography variant="bodySmall" sx={subtitleSx}>
        {t('analytics.health.tableSubtitle', 'Streamed and buffered responses are measured separately')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
        <Box sx={headerRowSx}>
          <Typography sx={combineSx(headerCellSx, { flex: 3 })}>
            {t('analytics.health.columnModel', 'Model')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnResponse', 'Response')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnTotal', 'Requests')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnErrors', 'Errors')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnErrorRate', 'Error Rate')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnAvgLatency', 'Avg')}
          </Typography>
          <Typography sx={combineSx(headerCellSx, { flex: 1 })}>
            {t('analytics.health.columnP95Latency', 'p95')}
          </Typography>
        </Box>
        {health.by_model.map((row, index) => (
          <Box key={`${row.provider}/${row.model}/${String(row.streaming)}`} sx={rowSx}>
            <Box sx={combineSx(cellValueSx, { flex: 3, display: 'flex', alignItems: 'center', gap: 1 })}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: theme.vars.shape.radiusPill,
                  backgroundColor: pickChartColor(index),
                  flexShrink: 0,
                }}
              />
              <Typography variant="bodySmall" noWrap>
                {row.model}
              </Typography>
            </Box>
            <Typography sx={combineSx(cellValueSx, { flex: 1 })}>
              {row.streaming
                ? t('analytics.health.streamed', 'streamed')
                : t('analytics.health.buffered', 'buffered')}
            </Typography>
            <Typography sx={combineSx(cellValueSx, { flex: 1 })}>{fmtNum(row.requests)}</Typography>
            <Typography
              sx={combineSx(cellValueSx, {
                flex: 1,
                color: row.errors > 0 ? theme.vars.palette.status.rejected : undefined,
              })}
            >
              {fmtNum(row.errors)}
            </Typography>
            <Typography
              sx={combineSx(cellValueSx, {
                flex: 1,
                color: row.error_rate > 5 ? theme.vars.palette.status.rejected : undefined,
              })}
            >
              {`${row.error_rate.toFixed(1)}%`}
            </Typography>
            <Typography sx={combineSx(cellValueSx, { flex: 1 })}>{fmtDuration(row.avg_duration_ms)}</Typography>
            <Typography sx={combineSx(cellValueSx, { flex: 1 })}>{fmtDuration(row.p95_duration_ms)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
