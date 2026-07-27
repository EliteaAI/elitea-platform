import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { useAnalyticsUserDetailQuery } from '../api/useAnalytics';
import { fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { AnalyticsKpiRow } from './components/AnalyticsKpiRow';
import { DailyUsageChart } from './components/DailyUsageChart';
import { DetailEmpty, DetailLoading } from './components/DetailStatus';
import { DetailHeader } from './components/DetailHeader';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsUserDetailed.jsx`.
 * Drill-down for a single user: KPIs (`AnalyticsKpiRow` — see that
 * component's header for why this replaces the baseline's
 * `llm_events`/`tool_events`/`chat_events`/`agent_events`/`active_days`/
 * `errors` card set, none of which exist on the real `AnalyticsKpis`),
 * daily-activity chart, and a compact dot-list of the tools/agents this
 * user touched (baseline: no header row, just name + count — visually
 * distinct from `AnalyticsAgentDetailed`/`AnalyticsToolDetailed`'s
 * header-table sibling lists, kept as its own inline rendering here rather
 * than forced through `EntityListCard`).
 *
 * DROPPED vs. the baseline: the "Models Used" card. Unlike the
 * users/tools/agents siblings (real, if currently-empty,
 * `AnalyticsDetailEnvelope` fields), there is NO `models` field anywhere on
 * the user-detail envelope (`src/shared/api/generated/model/
 * analyticsDetailEnvelope.zod.ts`: `entity_name`, `kpis`, `users?`,
 * `agents?`, `tools?`, `daily_usage` — confirmed against
 * `internal/api/v2/analytics/handler.go`'s `Users()` detail branch, which
 * writes exactly `entity_name`/`kpis`/`agents`/`tools`/`daily_usage`, never
 * `models`). Rendering a card whose data source can never exist would be
 * fabricated UI, not a port — omitted rather than backed by a hardcoded
 * empty array.
 */
export interface AnalyticsUserDetailedProps {
  readonly projectId: string | undefined;
  readonly userId: string;
  readonly userEmail: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly onBack: () => void;
}

const contentSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: (theme: Theme) => theme.spacing(2) };

const listsGridSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
  gap: (theme: Theme) => theme.spacing(2),
  alignItems: 'stretch',
};

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

const emptyTextSx = (theme: Theme) => ({ color: theme.vars.palette.text.metrics });

const listItemSx = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: `${theme.spacing(0.75)} 0`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  minWidth: 0,
  '&:last-child': { borderBottom: 'none' },
});

interface DotListProps {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly nameField: string;
  readonly countField: string;
  readonly emptyText: string;
}

function DotList({ title, subtitle, rows, nameField, countField, emptyText }: DotListProps): ReactNode {
  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {title}
      </Typography>
      <Typography
        variant="bodySmall"
        sx={subtitleSx}
      >
        {subtitle}
      </Typography>
      <Box sx={{ height: 300, overflowY: 'auto', overflowX: 'hidden' }}>
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <Box
              key={`${strField(row, nameField)}-${index}`}
              sx={listItemSx}
            >
              <Typography
                variant="bodySmall"
                noWrap
                sx={{ flex: 1 }}
              >
                {strField(row, nameField)}
              </Typography>
              <Typography
                variant="bodySmall"
                sx={(theme: Theme) => ({ color: theme.vars.palette.text.primary })}
              >
                {fmtNum(numField(row, countField))}
              </Typography>
            </Box>
          ))
        ) : (
          <Typography
            variant="bodySmall"
            sx={emptyTextSx}
          >
            {emptyText}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function AnalyticsUserDetailedImpl({
  projectId,
  userId,
  userEmail,
  dateFrom,
  dateTo,
  onBack,
}: AnalyticsUserDetailedProps): ReactNode {
  const { data, isFetching } = useAnalyticsUserDetailQuery(projectId, userId, { dateFrom, dateTo });

  if (isFetching) return <DetailLoading />;
  if (data === undefined) return <DetailEmpty />;

  const tools = data.tools ?? [];
  const agents = data.agents ?? [];

  return (
    <Box sx={contentSx}>
      <DetailHeader
        entityName={data.entity_name || userEmail}
        onBack={onBack}
      />
      <AnalyticsKpiRow kpis={data.kpis} />
      <DailyUsageChart
        title={t('analytics.userDetail.dailyActivityTitle', 'Daily Activity')}
        rows={data.daily_usage}
        primaryKey="events"
        primaryLabel={t('analytics.userDetail.seriesEvents', 'Events')}
        errorsLabel={t('analytics.userDetail.seriesErrors', 'Errors')}
      />
      <Box sx={listsGridSx}>
        <DotList
          title={t('analytics.userDetail.toolsTitle', 'Tools Used')}
          subtitle={t('analytics.userDetail.toolsSubtitle', '{{count}} tools', { count: tools.length })}
          rows={tools}
          nameField="tool_name"
          countField="calls"
          emptyText={t('analytics.userDetail.toolsEmpty', 'No tool usage')}
        />
        <DotList
          title={t('analytics.userDetail.agentsTitle', 'Agents Used')}
          subtitle={t('analytics.userDetail.agentsSubtitle', '{{count}} agents', { count: agents.length })}
          rows={agents}
          nameField="entity_name"
          countField="runs"
          emptyText={t('analytics.userDetail.agentsEmpty', 'No agent activity')}
        />
      </Box>
    </Box>
  );
}

export const AnalyticsUserDetailed = memo(AnalyticsUserDetailedImpl);
