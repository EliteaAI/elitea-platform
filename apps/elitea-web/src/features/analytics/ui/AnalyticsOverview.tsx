import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import type { ProjectAnalytics } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { pickChartColor, pickMedalColor } from '../lib/constants';
import { fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { AnalyticsKpiRow } from './components/AnalyticsKpiRow';
import { ChartTooltip } from './components/ChartTooltip';
import { ModelUsageTable } from './components/ModelUsageTable';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsOverview.jsx`.
 *
 * `top_ai_users`/`daily_activity` are `zod.looseObject({})` arrays (the Go
 * handler hardcodes both to `[]` today — see `lib/looseRecord.ts`'s
 * header), read defensively so the leaderboard/chart are forward-compatible
 * with a future backend that populates them, without asserting a shape the
 * schema does not promise.
 */
export interface AnalyticsOverviewProps {
  readonly data: ProjectAnalytics;
  readonly onUserClick?: (userId: string) => void;
}

const kpiRowWrapSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: (theme: Theme) => theme.spacing(2) };

const chartsGridSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
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

const leaderboardRowSx = (theme: Theme, clickable: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1),
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  '&:last-child': { borderBottom: 'none' },
  ...(clickable
    ? { cursor: 'pointer', '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover } }
    : {}),
});

const rankSx = (theme: Theme) => ({
  width: '1.25rem',
  textAlign: 'center' as const,
  fontSize: theme.typography.bodyMedium.fontSize,
  fontWeight: 700,
  color: theme.vars.palette.text.metrics,
});

const initialSx = (theme: Theme) => ({
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 700,
  color: theme.vars.palette.text.button.primary,
  lineHeight: 1,
});

const emailSx = (theme: Theme, clickable: boolean) => ({
  color: theme.vars.palette.text.secondary,
  fontWeight: 500,
  display: 'block',
  ...(clickable ? { '&:hover': { textDecoration: 'underline' } } : {}),
});

const statsSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  display: 'block',
  marginTop: theme.spacing(0.125),
});

const scoreSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  fontWeight: 700,
  fontSize: theme.typography.bodyMedium.fontSize,
  flexShrink: 0,
});

interface DailyActivityPoint {
  readonly date: string;
  readonly events: number;
  readonly users: number;
}

interface LeaderboardRow {
  readonly userId: string;
  readonly email: string;
  readonly llmCalls: number;
  readonly toolRuns: number;
  readonly agentRuns: number;
  readonly aiEvents: number;
}

function AnalyticsOverviewImpl({ data, onUserClick }: AnalyticsOverviewProps): ReactNode {
  const theme = useTheme();
  const axisStroke = theme.vars.palette.text.primary;
  const axisTickStyle = { fill: axisStroke, fontSize: theme.typography.labelSmall.fontSize };

  const dailyActivity = useMemo<DailyActivityPoint[]>(
    () =>
      data.daily_activity.map((point) => ({
        date: strField(point, 'date'),
        events: numField(point, 'events'),
        users: numField(point, 'users'),
      })),
    [data.daily_activity],
  );

  const topAiUsers = useMemo<LeaderboardRow[]>(
    () =>
      data.top_ai_users.map((row) => ({
        userId: strField(row, 'user_id'),
        email: strField(row, 'user_email'),
        llmCalls: numField(row, 'llm_calls'),
        toolRuns: numField(row, 'tool_runs'),
        agentRuns: numField(row, 'agent_runs'),
        aiEvents: numField(row, 'ai_events'),
      })),
    [data.top_ai_users],
  );

  const totalModelCalls = useMemo(() => data.models.reduce((sum, model) => sum + model.run_count, 0), [data.models]);

  return (
    <Box sx={kpiRowWrapSx}>
      <AnalyticsKpiRow kpis={data.kpis} />
      <Box sx={chartsGridSx}>
        <Box sx={cardSx}>
          <Typography
            variant="labelMedium"
            sx={titleSx}
          >
            {t('analytics.overview.dailyActivity.title', 'Daily Activity')}
          </Typography>
          <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <AreaChart data={dailyActivity}>
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
                  yAxisId="users"
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
                  name={t('analytics.overview.dailyActivity.seriesEvents', 'Events')}
                  stroke={theme.vars.palette.status.draft}
                  fill={theme.vars.palette.status.draft}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Area
                  yAxisId="users"
                  type="monotone"
                  dataKey="users"
                  name={t('analytics.overview.dailyActivity.seriesUsers', 'Users')}
                  stroke={theme.vars.palette.status.published}
                  fill={theme.vars.palette.status.published}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Box>
        <Box sx={cardSx}>
          <Typography
            variant="labelMedium"
            sx={titleSx}
          >
            {t('analytics.overview.leaderboard.title', 'Top 5 AI Adopters')}
          </Typography>
          <Typography
            variant="bodySmall"
            sx={subtitleSx}
          >
            {t('analytics.overview.leaderboard.subtitle', 'Leaderboard by AI events (LLM + Tool + Agent)')}
          </Typography>
          {topAiUsers.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
              {topAiUsers.map((user, index) => {
                const clickable = onUserClick !== undefined;
                return (
                  <Box
                    key={`${user.userId}-${index}`}
                    sx={leaderboardRowSx(theme, clickable)}
                    onClick={clickable ? () => onUserClick(user.userId) : undefined}
                  >
                    <Typography sx={rankSx}>{index + 1}</Typography>
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: theme.vars.shape.radiusPill,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        backgroundColor: index < 3 ? pickMedalColor(index) : pickChartColor(index - 3),
                      }}
                    >
                      <Typography sx={initialSx}>{(user.email || '?')[0]?.toUpperCase()}</Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="bodySmall"
                        noWrap
                        sx={emailSx(theme, clickable)}
                      >
                        {user.email}
                      </Typography>
                      <Typography
                        variant="bodySmall"
                        sx={statsSx}
                      >
                        {t('analytics.overview.leaderboard.stats', '{{llm}} LLM · {{tool}} Tool · {{agent}} Agent', {
                          llm: fmtNum(user.llmCalls),
                          tool: fmtNum(user.toolRuns),
                          agent: fmtNum(user.agentRuns),
                        })}
                      </Typography>
                    </Box>
                    <Typography
                      variant="bodyMedium"
                      sx={scoreSx}
                    >
                      {fmtNum(user.aiEvents)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Typography
              variant="bodySmall"
              sx={emptyTextSx}
            >
              {t('analytics.overview.leaderboard.empty', 'No AI activity data.')}
            </Typography>
          )}
        </Box>
      </Box>
      <ModelUsageTable
        models={data.models}
        totalCalls={totalModelCalls}
      />
    </Box>
  );
}

export const AnalyticsOverview = memo(AnalyticsOverviewImpl);
