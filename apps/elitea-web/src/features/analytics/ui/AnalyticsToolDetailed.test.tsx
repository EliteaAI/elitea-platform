import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsToolDetailed } from './AnalyticsToolDetailed';

const BASE = '/api/v2';
const RANGE = { dateFrom: '2026-07-20T00:00:00.000Z', dateTo: '2026-07-27T00:00:00.000Z' };
const DETAIL_URL = `${BASE}/elitea_core/analytics_tool_detail/prompt_lib/7`;
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

describe('AnalyticsToolDetailed', () => {
  it('shows a loading spinner before the query resolves', () => {
    server.use(http.get(DETAIL_URL, async () => new Promise(() => {})));
    const { getByRole } = renderScreen(
      <AnalyticsToolDetailed
        projectId="7"
        toolkitId="tk1"
        toolName="web_search"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(getByRole('progressbar')).toBeInTheDocument();
  });

  it('falls back to the already-known toolName when the stub entity_name is empty', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: '', kpis: ZERO_KPIS, users: [], agents: [], daily_usage: [] }),
      ),
    );
    const { findByText } = renderScreen(
      <AnalyticsToolDetailed
        projectId="7"
        toolkitId="tk1"
        toolName="web_search"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('web_search')).toBeInTheDocument();
  });

  it('prefers a real entity_name over the fallback toolName when the backend provides one', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: 'Real Tool Name', kpis: ZERO_KPIS, users: [], agents: [], daily_usage: [] }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsToolDetailed
        projectId="7"
        toolkitId="tk1"
        toolName="web_search"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('Real Tool Name')).toBeInTheDocument();
    expect(queryByText('web_search')).not.toBeInTheDocument();
  });

  it('renders sibling users/agents rows when present', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'web_search',
          kpis: ZERO_KPIS,
          users: [{ user_id: 'u1', user_email: 'a@x.com', calls: 2, avg_duration_ms: 10, errors: 0 }],
          agents: [{ entity_name: 'Agent One', calls: 3 }],
          daily_usage: [],
        }),
      ),
    );
    const { findByText, getByText } = renderScreen(
      <AnalyticsToolDetailed
        projectId="7"
        toolkitId="tk1"
        toolName="web_search"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={() => {}}
      />,
    );
    expect(await findByText('a@x.com')).toBeInTheDocument();
    expect(getByText('Agent One')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: '', kpis: ZERO_KPIS, users: [], agents: [], daily_usage: [] }),
      ),
    );
    const user = userEvent.setup();
    const onBack = vi.fn();
    const { findByRole } = renderScreen(
      <AnalyticsToolDetailed
        projectId="7"
        toolkitId="tk1"
        toolName="web_search"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        onBack={onBack}
      />,
    );
    await user.click(await findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
