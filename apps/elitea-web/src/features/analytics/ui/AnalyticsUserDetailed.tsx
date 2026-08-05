import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import { t } from '@/shared/i18n';

import { useAnalyticsUserDetailQuery } from '../api/useAnalytics';
import { fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { AnalyticsKpiRow } from './components/AnalyticsKpiRow';
import { ChartTooltip } from './components/ChartTooltip';
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
 * NOTE(A10-fix, daily-activity chart shape): the local `DailyActivityChart`
 * below renders this screen's OWN chart contract — `llm`/`tool` on the left
 * axis, `chat`/`agent` on the right, ported field-for-field/axis-for-axis
 * from the baseline JSX's inline 4-series `AreaChart` (no `errors` series;
 * the baseline chart never had one). This is DELIBERATELY NOT the shared
 * `ui/components/DailyUsageChart` component `AnalyticsAgentDetailed`/
 * `AnalyticsToolDetailed` use — that component's `events`/`calls`-vs-
 * `errors` shape matches THEIR baselines, not this screen's. A prior
 * revision of this file called the shared component here too, which
 * silently reshaped the baseline's per-type breakdown into that generic
 * events-vs-errors chart and introduced an `errors` series the baseline
 * User Detail chart never had (this unit's confirmed finding). Like every
 * other array on `AnalyticsDetailEnvelope`, `daily_usage` is a
 * `zod.looseObject({})` the Go handler hardcodes to `[]` today (see
 * `lib/looseRecord.ts`'s header) — reading `llm`/`tool`/`chat`/`agent`
 * fields off it is exactly as speculative/forward-compatible as the shared
 * component reading `events`/`errors` off the same kind of row for its own
 * screens; neither is backed by a real populated field yet.
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

/** One day's per-event-type counts, as read off `AnalyticsDetailEnvelope.daily_usage`'s loose rows. */
export interface DailyActivityPoint {
  readonly date: string;
  readonly llm: number;
  readonly tool: number;
  readonly chat: number;
  readonly agent: number;
}

/**
 * Reads this screen's OWN `llm`/`tool`/`chat`/`agent` per-day breakdown off
 * `daily_usage` — see the top-of-file NOTE(A10-fix) for why this must not
 * be the `events`/`errors` shape `ui/components/DailyUsageChart` reads for
 * its own (Agent/Tool Detailed) callers. Exported as a plain, pure function
 * so this mapping — the crux of the confirmed finding this fixes — is
 * directly unit-testable without going through `recharts`' SVG rendering.
 */
export function dailyActivityPoints(rows: readonly Readonly<Record<string, unknown>>[]): readonly DailyActivityPoint[] {
  return rows.map((row) => ({
    date: strField(row, 'date'),
    llm: numField(row, 'llm'),
    tool: numField(row, 'tool'),
    chat: numField(row, 'chat'),
    agent: numField(row, 'agent'),
  }));
}

interface DailyActivityChartProps {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/**
 * User Detail's own daily-activity chart. `llm`+`tool` share the left axis,
 * `chat`+`agent` share the right — axes, colours, and series ordering are
 * ported unchanged from the baseline JSX's inline `AreaChart`. No `errors`
 * series: the baseline User Detail chart never had one.
 */
function DailyActivityChart({ rows }: DailyActivityChartProps): ReactNode {
  const theme = useTheme();
  const axisStroke = theme.vars.palette.text.primary;
  const axisTickStyle = { fill: axisStroke, fontSize: theme.typography.labelSmall.fontSize };
  const points = useMemo(() => dailyActivityPoints(rows), [rows]);

  if (points.length === 0) return null;

  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {t('analytics.userDetail.dailyActivityTitle', 'Daily Activity')}
      </Typography>
      <Typography
        variant="bodySmall"
        sx={subtitleSx}
      >
        {t('analytics.userDetail.dailyActivitySubtitle', 'Events by type per day')}
      </Typography>
      <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
        <ResponsiveContainer
          width="100%"
          height={220}
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
              yAxisId="left"
              tick={axisTickStyle}
              axisLine={{ stroke: axisStroke }}
              tickLine={{ stroke: axisStroke }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={axisTickStyle}
              axisLine={{ stroke: axisStroke }}
              tickLine={{ stroke: axisStroke }}
            />
            <RechartsTooltip content={<ChartTooltip />} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="llm"
              name={t('analytics.userDetail.seriesLlm', 'LLM')}
              stroke={theme.vars.palette.status.draft}
              fill={theme.vars.palette.status.draft}
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="tool"
              name={t('analytics.userDetail.seriesTool', 'Tool')}
              stroke={theme.vars.palette.status.published}
              fill={theme.vars.palette.status.published}
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="chat"
              name={t('analytics.userDetail.seriesChat', 'Chat Msg')}
              stroke={theme.vars.palette.status.userApproval}
              fill={theme.vars.palette.status.userApproval}
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="agent"
              name={t('analytics.userDetail.seriesAgent', 'Agent')}
              stroke={theme.vars.palette.status.onModeration}
              fill={theme.vars.palette.status.onModeration}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

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
      <DailyActivityChart rows={data.daily_usage} />
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
