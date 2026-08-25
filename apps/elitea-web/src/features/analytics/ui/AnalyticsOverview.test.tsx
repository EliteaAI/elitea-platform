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
