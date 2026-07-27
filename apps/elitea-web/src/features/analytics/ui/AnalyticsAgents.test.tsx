import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsAgents } from './AnalyticsAgents';

const BASE = '/api/v2';
const RANGE = { dateFrom: '2026-07-20T00:00:00.000Z', dateTo: '2026-07-27T00:00:00.000Z' };

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

describe('AnalyticsAgents', () => {
  it('renders the table with agent rows once the list resolves', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_agents/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ application_id: 'app1', name: 'My Agent', run_count: 12, avg_duration_ms: 300, total_tokens: 5, error_rate: 0 }],
        }),
      ),
    );
    const { findByText, getByText } = renderScreen(
      <AnalyticsAgents
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('My Agent')).toBeInTheDocument();
    expect(getByText('Agent Activity')).toBeInTheDocument();
  });

  it('renders no chart when there are no agents yet', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_agents/prompt_lib/7`, () => HttpResponse.json({ items: [] })),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsAgents
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('Agent Activity')).toBeInTheDocument();
    expect(queryByText('Most Active Agents')).not.toBeInTheDocument();
  });

  it('drills into AnalyticsAgentDetailed when a row is clicked, sending application_id (the defect fix)', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_agents/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ application_id: 'app1', name: 'My Agent', run_count: 12, avg_duration_ms: 300, total_tokens: 5, error_rate: 0 }],
        }),
      ),
      http.get(`${BASE}/elitea_core/analytics_agent_detail/prompt_lib/7`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('application_id')).toBe('app1');
        expect(url.searchParams.has('entity_id')).toBe(false);
        return HttpResponse.json({ entity_name: 'My Agent', kpis: {}, users: [], tools: [], daily_usage: [] });
      }),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, queryByText } = renderScreen(
      <AnalyticsAgents
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await user.click(await findByText('My Agent'));

    // The list's own chrome is gone; the detail screen's back button is present.
    expect(queryByText('Agent Activity')).not.toBeInTheDocument();
    expect(await findByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
