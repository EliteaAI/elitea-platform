import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectAnalytics } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsOverview } from './AnalyticsOverview';

const BASE_DATA: ProjectAnalytics = {
  // Only the figures the server actually measures. tool_runs/chat_msgs/
  // agent_runs/unique_users have no producer and are omitted from the
  // response, so including them here would fixture a shape no server sends.
  kpis: {
    total_project_users: 10,
    ai_active_users: 3,
    adoption_rate: 30,
    llm_calls: 42,
    total_tokens: 900,
  },
  top_ai_users: [],
  daily_activity: [],
  models: [],
  models_truncated: false,
};

const ALICE = {
  user_id: 'u1',
  email: 'alice@example.com',
  run_count: 13,
  total_tokens: 400,
  last_active_at: '2026-08-20T10:00:00Z',
};

describe('AnalyticsOverview', () => {
  it('renders the KPI row', () => {
    const { getByText } = renderWithTheme(<AnalyticsOverview data={BASE_DATA} />);
    expect(getByText('AI ACTIVE')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
  });

  /**
   * Cost is not on this endpoint's response at all — /analytics_costs owns the
   * money — so the tile appears only when the container passes it down.
   */
  it('renders the cost tile from the separately-fetched figure', () => {
    const { queryByText } = renderWithTheme(<AnalyticsOverview data={BASE_DATA} />);
    expect(queryByText('COST')).not.toBeInTheDocument();

    const { getByText: withCost } = renderWithTheme(
      <AnalyticsOverview
        data={BASE_DATA}
        totalCost="$7.25"
      />,
    );
    expect(withCost('COST')).toBeInTheDocument();
    expect(withCost('$7.25')).toBeInTheDocument();
  });

  it('shows the empty leaderboard message when top_ai_users is empty', () => {
    const { getByText } = renderWithTheme(<AnalyticsOverview data={BASE_DATA} />);
    expect(getByText('No AI activity data.')).toBeInTheDocument();
  });

  it('renders leaderboard rows from the typed top_ai_users entries', () => {
    const data: ProjectAnalytics = { ...BASE_DATA, top_ai_users: [ALICE] };
    const { getByText, queryByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('alice@example.com')).toBeInTheDocument();
    expect(getByText('13')).toBeInTheDocument();
    expect(queryByText('No AI activity data.')).not.toBeInTheDocument();
  });

  /**
   * The server reports a member whose identity it could not resolve with an
   * EMPTY email rather than dropping the row — the identity tables belong to
   * another corpus and may be absent. A blank leaderboard entry is worse than
   * an id, so the id is what shows.
   */
  it('falls back to the user id when the identity join produced no email', () => {
    const data: ProjectAnalytics = { ...BASE_DATA, top_ai_users: [{ ...ALICE, email: '' }] };
    const { getByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('#u1')).toBeInTheDocument();
  });

  /** A display name, when there is one, beats the email. */
  it('prefers the display name over the email', () => {
    const data: ProjectAnalytics = { ...BASE_DATA, top_ai_users: [{ ...ALICE, name: 'Alice A.' }] };
    const { getByText, queryByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('Alice A.')).toBeInTheDocument();
    expect(queryByText('alice@example.com')).not.toBeInTheDocument();
  });

  it('calls onUserClick with the row\'s user_id when a leaderboard row is clicked', async () => {
    const user = userEvent.setup();
    const onUserClick = vi.fn();
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      top_ai_users: [ALICE],
    };
    const { getByText } = renderWithTheme(
      <AnalyticsOverview
        data={data}
        onUserClick={onUserClick}
      />,
    );
    await user.click(getByText('alice@example.com'));
    expect(onUserClick).toHaveBeenCalledWith('u1');
  });

  it('does not make leaderboard rows clickable when onUserClick is omitted', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      top_ai_users: [ALICE],
    };
    expect(() => renderWithTheme(<AnalyticsOverview data={data} />)).not.toThrow();
  });

  it('renders the model usage table when models are present', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      models: [{ model: 'claude-sonnet', provider: 'anthropic', prompt_tokens: 10, completion_tokens: 5, run_count: 4 }],
    };
    const { getByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('renders the daily-activity chart from typed points', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      daily_activity: [{ date: '2026-07-20', llm_calls: 10, total_tokens: 500, active_users: 3 }],
    };
    expect(() => renderWithTheme(<AnalyticsOverview data={data} />)).not.toThrow();
  });
});

describe('AnalyticsOverview model shares', () => {
  const MODELS = [
    { model: 'a', provider: 'p', prompt_tokens: 0, completion_tokens: 0, run_count: 60 },
    { model: 'b', provider: 'p', prompt_tokens: 0, completion_tokens: 0, run_count: 40 },
  ];

  it('normalises shares over the returned models when the list is complete', () => {
    const data: ProjectAnalytics = { ...BASE_DATA, models: MODELS, models_truncated: false };
    const { getByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('60.0%')).toBeInTheDocument();
    expect(getByText('40.0%')).toBeInTheDocument();
  });

  /**
   * A cut list summed as if it were whole makes every share a percentage of the
   * busiest N. Here the two rows are 100 of a real 1000 calls: normalised over
   * themselves they would read 60%/40% and add to 100%, while the LLM CALLS
   * tile beside them says 1000.
   */
  it('normalises over the real request count when the server says it cut the list', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      kpis: { ...BASE_DATA.kpis, llm_calls: 1000 },
      models: MODELS,
      models_truncated: true,
    };
    const { getByText, queryByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('6.0%')).toBeInTheDocument();
    expect(getByText('4.0%')).toBeInTheDocument();
    expect(queryByText('60.0%')).not.toBeInTheDocument();
  });
});
