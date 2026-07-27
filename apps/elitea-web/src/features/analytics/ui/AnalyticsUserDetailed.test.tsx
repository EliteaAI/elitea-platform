import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsUserDetailed } from './AnalyticsUserDetailed';

const BASE = '/api/v2';
const RANGE = { dateFrom: '2026-07-20T00:00:00.000Z', dateTo: '2026-07-27T00:00:00.000Z' };
const DETAIL_URL = `${BASE}/elitea_core/analytics_user_detail/prompt_lib/7`;
const ZERO_KPIS = {
  unique_users: 0,
  total_project_users: 0,
  ai_active_users: 0,
  adoption_rate: 0,
  llm_calls: 0,
  tool_runs: 0,
  chat_msgs: 0,
  agent_runs: 0,
};

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

describe('AnalyticsUserDetailed', () => {
  it('shows a loading spinner before the query resolves', () => {
    server.use(http.get(DETAIL_URL, async () => new Promise(() => {})));
    const { getByRole } = renderScreen(
      <AnalyticsUserDetailed
        projectId="7"
        userId="u1"
        userEmail="a@x.com"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(getByRole('progressbar')).toBeInTheDocument();
  });

  it('falls back to the already-known userEmail when the stub entity_name is empty', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json({ entity_name: '', kpis: ZERO_KPIS, agents: [], tools: [], daily_usage: [] })),
    );
    const { findByText } = renderScreen(
      <AnalyticsUserDetailed
        projectId="7"
        userId="u1"
        userEmail="a@x.com"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('a@x.com')).toBeInTheDocument();
  });

  it('renders the Tools Used / Agents Used dot-lists (no Models Used card — no backing field)', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'a@x.com',
          kpis: ZERO_KPIS,
          agents: [{ entity_name: 'Agent One', runs: 4 }],
          tools: [{ tool_name: 'search', calls: 2 }],
          daily_usage: [],
        }),
      ),
    );
    const { findByText, getByText, queryByText } = renderScreen(
      <AnalyticsUserDetailed
        projectId="7"
        userId="u1"
        userEmail="a@x.com"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('Agent One')).toBeInTheDocument();
    expect(getByText('search')).toBeInTheDocument();
    expect(queryByText('Models Used')).not.toBeInTheDocument();
  });

  it('renders empty-state text for tools/agents when both are absent', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: 'a@x.com', kpis: ZERO_KPIS, agents: [], tools: [], daily_usage: [] }),
      ),
    );
    const { findByText, getByText } = renderScreen(
      <AnalyticsUserDetailed
        projectId="7"
        userId="u1"
        userEmail="a@x.com"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    await findByText('a@x.com');
    expect(getByText('No tool usage')).toBeInTheDocument();
    expect(getByText('No agent activity')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: 'a@x.com', kpis: ZERO_KPIS, agents: [], tools: [], daily_usage: [] }),
      ),
    );
    const user = userEvent.setup();
    const onBack = vi.fn();
    const { findByRole } = renderScreen(
      <AnalyticsUserDetailed
        projectId="7"
        userId="u1"
        userEmail="a@x.com"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={onBack}
      />,
    );
    await user.click(await findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
