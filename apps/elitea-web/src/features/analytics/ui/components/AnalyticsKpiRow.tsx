import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { AnalyticsKpis } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { fmtNum } from '../../lib/format';
import { KpiCard } from './KpiCard';

/**
 * The 6-tile KPI row shared by `AnalyticsOverview` and all three detail
 * screens (`AnalyticsAgentDetailed`/`AnalyticsToolDetailed`/
 * `AnalyticsUserDetailed`).
 *
 * The baseline had FOUR different, divergent KPI card sets — Overview's own
 * 6 cards, and three more per-detail-screen sets reading fields
 * (`total_events`, `avg_duration_ms`, `errors`, `error_rate`,
 * `total_calls`, `llm_events`, `active_days`, …) that do not exist
 * anywhere in the real backend's `AnalyticsKpis` type
 * (`src/shared/api/generated/model/analyticsKpis.zod.ts`: `unique_users`,
 * `total_project_users`, `ai_active_users`, `adoption_rate`, `llm_calls`,
 * `tool_runs`, `chat_msgs`, `agent_runs`, plus two usage-only optional
 * fields) — confirmed against
 * `internal/api/v2/analytics/handler.go`'s four handlers, all of which
 * build every "kpis" object (Usage AND all three "detail" stubs) from
 * exactly this one 8-key shape. There is only ONE kpis shape in this
 * domain; this component is its one renderer, replacing four incompatible,
 * partially-broken card sets with one real one. See this unit's final
 * report for the full defect writeup.
 */
export interface AnalyticsKpiRowProps {
  readonly kpis: AnalyticsKpis;
}

const rowSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: (theme: Theme) => theme.spacing(2),
};

function AnalyticsKpiRowImpl({ kpis }: AnalyticsKpiRowProps): ReactNode {
  const adoptionRate = kpis.adoption_rate;

  return (
    // The testid is the @visual suite's landmark for "the analytics query has
    // resolved and the tab content is painted". Before it existed, the visual
    // spec waited on `getByRole('main')` — which is satisfied by the loading
    // spinner — and the committed baseline was a picture of that spinner
    // (run 31345403013, issue #159).
    <Box sx={rowSx} data-testid="analytics-kpi-row">
      <KpiCard
        label={t('analytics.kpi.team.label', 'TEAM')}
        value={fmtNum(kpis.unique_users)}
        valueSuffix={t('analytics.kpi.team.suffix', 'of {{total}}', { total: fmtNum(kpis.total_project_users) })}
        subtitle={t('analytics.kpi.team.subtitle', 'active members')}
      />
      <KpiCard
        label={t('analytics.kpi.aiActive.label', 'AI ACTIVE')}
        value={fmtNum(kpis.ai_active_users)}
        {...(adoptionRate > 0
          ? { badge: t('analytics.kpi.aiActive.badge', '↑{{rate}}%', { rate: adoptionRate }) }
          : {})}
        subtitle={t('analytics.kpi.aiActive.subtitle', '{{rate}}% adoption', { rate: adoptionRate })}
      />
      <KpiCard
        label={t('analytics.kpi.llmCalls.label', 'LLM CALLS')}
        value={fmtNum(kpis.llm_calls)}
        subtitle={t('analytics.kpi.llmCalls.subtitle', 'event_type = llm')}
      />
      <KpiCard
        label={t('analytics.kpi.toolRuns.label', 'TOOL RUNS')}
        value={fmtNum(kpis.tool_runs)}
        subtitle={t('analytics.kpi.toolRuns.subtitle', 'event_type = tool')}
      />
      <KpiCard
        label={t('analytics.kpi.chatMsg.label', 'CHAT MSG')}
        value={fmtNum(kpis.chat_msgs)}
        subtitle={t('analytics.kpi.chatMsg.subtitle', 'user messages sent')}
      />
      <KpiCard
        label={t('analytics.kpi.agentRuns.label', 'AGENT RUNS')}
        value={fmtNum(kpis.agent_runs)}
        subtitle={t('analytics.kpi.agentRuns.subtitle', 'agents and pipelines interactions')}
      />
    </Box>
  );
}

export const AnalyticsKpiRow = memo(AnalyticsKpiRowImpl);
