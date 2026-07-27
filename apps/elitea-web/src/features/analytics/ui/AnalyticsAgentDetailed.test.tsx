import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsAgentDetailed } from './AnalyticsAgentDetailed';

const BASE = '/api/v2';
const RANGE = { dateFrom: '2026-07-20T00:00:00.000Z', dateTo: '2026-07-27T00:00:00.000Z' };
const DETAIL_URL = `${BASE}/elitea_core/analytics_agent_detail/prompt_lib/7`;

function renderScreen(ui: ReactElement): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithTheme(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AnalyticsAgentDetailed', () => {
  it('shows a loading spinner before the query resolves', () => {
    server.use(http.get(DETAIL_URL, async () => new Promise(() => {})));
    const { getByRole } = renderScreen(
      <AnalyticsAgentDetailed
        projectId="7"
        applicationId="app1"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders the KPI row, empty sibling lists, and the entity name once resolved', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'My Agent',
          kpis: {
            unique_users: 1,
            total_project_users: 2,
            ai_active_users: 1,
            adoption_rate: 50,
            llm_calls: 3,
            tool_runs: 1,
            chat_msgs: 0,
            agent_runs: 1,
          },
          users: [],
          tools: [],
          daily_usage: [],
        }),
      ),
    );
    const { findByText, getByText } = renderScreen(
      <AnalyticsAgentDetailed
        projectId="7"
        applicationId="app1"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('My Agent')).toBeInTheDocument();
    expect(getByText('No user data')).toBeInTheDocument();
    expect(getByText('No tool data')).toBeInTheDocument();
  });

  it('renders sibling users/tools rows when present', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'My Agent',
          kpis: { unique_users: 0, total_project_users: 0, ai_active_users: 0, adoption_rate: 0, llm_calls: 0, tool_runs: 0, chat_msgs: 0, agent_runs: 0 },
          users: [{ user_id: 'u1', user_email: 'a@x.com', events: 4, avg_duration_ms: 50, errors: 0 }],
          tools: [{ tool_name: 'search', calls: 9 }],
          daily_usage: [{ date: '2026-07-20', events: 5, errors: 0 }],
        }),
      ),
    );
    const { findByText, getByText } = renderScreen(
      <AnalyticsAgentDetailed
        projectId="7"
        applicationId="app1"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('a@x.com')).toBeInTheDocument();
    expect(getByText('search')).toBeInTheDocument();
    expect(getByText('Daily Usage')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'My Agent',
          kpis: { unique_users: 0, total_project_users: 0, ai_active_users: 0, adoption_rate: 0, llm_calls: 0, tool_runs: 0, chat_msgs: 0, agent_runs: 0 },
          users: [],
          tools: [],
          daily_usage: [],
        }),
      ),
    );
    const user = userEvent.setup();
    const onBack = vi.fn();
    const { findByRole } = renderScreen(
      <AnalyticsAgentDetailed
        projectId="7"
        applicationId="app1"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={onBack}
      />,
    );
    await user.click(await findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
