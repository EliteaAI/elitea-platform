import { describe, expect, it } from 'vitest';

import type { AnalyticsKpis } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsKpiRow } from './AnalyticsKpiRow';

const BASE_KPIS: AnalyticsKpis = {
  unique_users: 5,
  total_project_users: 10,
  ai_active_users: 3,
  adoption_rate: 30,
  llm_calls: 42,
  tool_runs: 7,
  chat_msgs: 100,
  agent_runs: 9,
};

describe('AnalyticsKpiRow', () => {
  it('renders all six baseline KPI cards with formatted values', () => {
    const { getByText } = renderWithTheme(<AnalyticsKpiRow kpis={BASE_KPIS} />);
    expect(getByText('TEAM')).toBeInTheDocument();
    expect(getByText('5')).toBeInTheDocument();
    expect(getByText('of 10')).toBeInTheDocument();
    expect(getByText('AI ACTIVE')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('LLM CALLS')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
    expect(getByText('TOOL RUNS')).toBeInTheDocument();
    expect(getByText('7')).toBeInTheDocument();
    expect(getByText('CHAT MSG')).toBeInTheDocument();
    expect(getByText('100')).toBeInTheDocument();
    expect(getByText('AGENT RUNS')).toBeInTheDocument();
    expect(getByText('9')).toBeInTheDocument();
  });

  it('shows a positive-delta badge only when adoption_rate is above zero', () => {
    const { getByText } = renderWithTheme(<AnalyticsKpiRow kpis={BASE_KPIS} />);
    expect(getByText('↑30%')).toBeInTheDocument();
  });

  it('omits the badge when adoption_rate is zero', () => {
    const { queryByText } = renderWithTheme(<AnalyticsKpiRow kpis={{ ...BASE_KPIS, adoption_rate: 0 }} />);
    expect(queryByText(/↑/)).not.toBeInTheDocument();
  });

  it('handles the all-zero stub kpis the real detail endpoints return today', () => {
    const zeroKpis: AnalyticsKpis = {
      unique_users: 0,
      total_project_users: 0,
      ai_active_users: 0,
      adoption_rate: 0,
      llm_calls: 0,
      tool_runs: 0,
      chat_msgs: 0,
      agent_runs: 0,
    };
    const { getAllByText } = renderWithTheme(<AnalyticsKpiRow kpis={zeroKpis} />);
    expect(getAllByText('0').length).toBeGreaterThan(0);
  });
});
