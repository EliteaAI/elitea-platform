import { describe, expect, it } from 'vitest';

import type { AnalyticsKpis } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsKpiRow } from './AnalyticsKpiRow';

/**
 * What a deployment WITH the gateway request log and the identity tables
 * reports. Note what is not here: `unique_users`, `tool_runs`, `chat_msgs` and
 * `agent_runs` have no producer anywhere in the platform, and the server omits
 * them rather than sending zeros — so a fixture that included them would be
 * testing a response no server sends.
 */
const FULL_KPIS: AnalyticsKpis = {
  total_project_users: 10,
  ai_active_users: 3,
  adoption_rate: 30,
  llm_calls: 42,
  total_tokens: 1234,
};

describe('AnalyticsKpiRow', () => {
  it('renders a tile per figure the server measured', () => {
    const { getByText } = renderWithTheme(<AnalyticsKpiRow kpis={FULL_KPIS} />);
    expect(getByText('AI ACTIVE')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('of 10')).toBeInTheDocument();
    expect(getByText('LLM CALLS')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
    expect(getByText('TOKENS')).toBeInTheDocument();
    expect(getByText('1.2K')).toBeInTheDocument(); // fmtNum abbreviates at 1,000
  });

  /**
   * The property the whole row exists for. An absent figure is the server
   * saying "nothing in this platform produces this" — a tile reading 0 would be
   * a measurement, which is the exact defect (#303) the endpoint was rebuilt to
   * stop committing, one layer up.
   */
  it('renders no tile for a figure the server did not send', () => {
    const { queryByText } = renderWithTheme(<AnalyticsKpiRow kpis={FULL_KPIS} />);
    for (const label of ['TOOL RUNS', 'CHAT MSG', 'AGENT RUNS', 'TEAM']) {
      expect(queryByText(label)).not.toBeInTheDocument();
    }
    // And no stray zero stands in for one of them.
    expect(queryByText('0')).not.toBeInTheDocument();
  });

  /**
   * The denominator comes from identity tables this service does not own, so a
   * deployment can legitimately report AI-active users and no membership at
   * all. The tile must still say how many people used AI — it just cannot say
   * out of how many.
   */
  it('reports active users without a denominator when membership is unavailable', () => {
    const { getByText, queryByText } = renderWithTheme(
      <AnalyticsKpiRow kpis={{ ai_active_users: 3, llm_calls: 42 }} />,
    );
    expect(getByText('AI ACTIVE')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(queryByText(/^of /)).not.toBeInTheDocument();
    expect(queryByText(/↑/)).not.toBeInTheDocument();
  });

  it('shows a positive-delta badge only when adoption_rate is above zero', () => {
    const { getByText } = renderWithTheme(<AnalyticsKpiRow kpis={FULL_KPIS} />);
    expect(getByText('↑30%')).toBeInTheDocument();
  });

  it('omits the badge when adoption_rate is zero', () => {
    const { queryByText } = renderWithTheme(<AnalyticsKpiRow kpis={{ ...FULL_KPIS, adoption_rate: 0 }} />);
    expect(queryByText(/↑/)).not.toBeInTheDocument();
  });

  /**
   * The three detail screens answer without a kpis block at all — the
   * per-entity split they would need is the one dimension the request log does
   * not carry — so the row must render nothing rather than throw on the way to
   * reading a field of `undefined`.
   */
  it('renders an empty row when the response carried no kpis block', () => {
    const { getByTestId } = renderWithTheme(<AnalyticsKpiRow kpis={undefined} />);
    expect(getByTestId('analytics-kpi-row').children).toHaveLength(0);
  });

  /** Cost comes from /analytics_costs, not from the usage response. */
  it('renders the cost tile only when a cost was supplied', () => {
    const { queryByText } = renderWithTheme(<AnalyticsKpiRow kpis={FULL_KPIS} />);
    expect(queryByText('COST')).not.toBeInTheDocument();

    const { getByText } = renderWithTheme(
      <AnalyticsKpiRow
        kpis={FULL_KPIS}
        totalCost="$12.34"
      />,
    );
    expect(getByText('COST')).toBeInTheDocument();
    expect(getByText('$12.34')).toBeInTheDocument();
  });
});
