import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectAnalytics } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsOverview } from './AnalyticsOverview';

const BASE_DATA: ProjectAnalytics = {
  kpis: {
    unique_users: 5,
    total_project_users: 10,
    ai_active_users: 3,
    adoption_rate: 30,
    llm_calls: 42,
    tool_runs: 7,
    chat_msgs: 100,
    agent_runs: 9,
  },
  top_ai_users: [],
  daily_activity: [],
  models: [],
};

describe('AnalyticsOverview', () => {
  it('renders the KPI row', () => {
    const { getByText } = renderWithTheme(<AnalyticsOverview data={BASE_DATA} />);
    expect(getByText('TEAM')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
  });

  it('shows the empty leaderboard message when top_ai_users is empty', () => {
    const { getByText } = renderWithTheme(<AnalyticsOverview data={BASE_DATA} />);
    expect(getByText('No AI activity data.')).toBeInTheDocument();
  });

  it('renders leaderboard rows from loosely-shaped top_ai_users entries', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      top_ai_users: [
        { user_id: 'u1', user_email: 'alice@example.com', llm_calls: 10, tool_runs: 2, agent_runs: 1, ai_events: 13 },
      ],
    };
    const { getByText, queryByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('alice@example.com')).toBeInTheDocument();
    expect(getByText('13')).toBeInTheDocument();
    expect(queryByText('No AI activity data.')).not.toBeInTheDocument();
  });

  it('calls onUserClick with the row\'s user_id when a leaderboard row is clicked', async () => {
    const user = userEvent.setup();
    const onUserClick = vi.fn();
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      top_ai_users: [{ user_id: 'u1', user_email: 'alice@example.com', llm_calls: 1, tool_runs: 1, agent_runs: 1, ai_events: 3 }],
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
      top_ai_users: [{ user_id: 'u1', user_email: 'alice@example.com', llm_calls: 1, tool_runs: 1, agent_runs: 1, ai_events: 3 }],
    };
    expect(() => renderWithTheme(<AnalyticsOverview data={data} />)).not.toThrow();
  });

  it('renders the model usage table when models are present', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      models: [{ model: 'claude-sonnet', prompt_tokens: 10, completion_tokens: 5, total_cost: 0.1, run_count: 4 }],
    };
    const { getByText } = renderWithTheme(<AnalyticsOverview data={data} />);
    expect(getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('renders daily-activity leaderboard-adjacent labels from loosely-shaped points without crashing', () => {
    const data: ProjectAnalytics = {
      ...BASE_DATA,
      daily_activity: [{ date: '2026-07-20', events: 10, users: 3 }],
    };
    expect(() => renderWithTheme(<AnalyticsOverview data={data} />)).not.toThrow();
  });
});
