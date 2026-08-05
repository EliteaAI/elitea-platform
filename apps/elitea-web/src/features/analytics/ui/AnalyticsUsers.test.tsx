import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsUsers } from './AnalyticsUsers';

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

describe('AnalyticsUsers', () => {
  it('renders the table with user rows once the list resolves', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ user_id: 'u1', email: 'bob@example.com', run_count: 6, last_active_at: '2026-07-22T00:00:00Z' }],
        }),
      ),
    );
    const { findByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('bob@example.com')).toBeInTheDocument();
  });

  it('renders UNAVAILABLE_METRIC for the six per-type-breakdown columns the real backend does not provide', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ user_id: 'u1', email: 'bob@example.com', run_count: 6, last_active_at: '2026-07-22T00:00:00Z' }],
        }),
      ),
    );
    const { findByText, getAllByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await findByText('bob@example.com');
    expect(getAllByText('–')).toHaveLength(6);
  });

  it('filters rows client-side to the selected date range using last_active_at (the date-picker-is-inert defect fix)', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [
            // Inside RANGE (2026-07-20..2026-07-27).
            { user_id: 'u1', email: 'in-range@example.com', run_count: 6, last_active_at: '2026-07-22T00:00:00Z' },
            // Before RANGE.
            { user_id: 'u2', email: 'too-old@example.com', run_count: 3, last_active_at: '2026-07-01T00:00:00Z' },
            // After RANGE.
            { user_id: 'u3', email: 'too-new@example.com', run_count: 9, last_active_at: '2026-08-01T00:00:00Z' },
          ],
        }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('in-range@example.com')).toBeInTheDocument();
    expect(queryByText('too-old@example.com')).not.toBeInTheDocument();
    expect(queryByText('too-new@example.com')).not.toBeInTheDocument();
    // The subtitle count reflects the filtered set, not the raw response.
    expect(await findByText('1 users')).toBeInTheDocument();
  });

  it('drills into AnalyticsUserDetailed sending user_id, and clicking Back returns to the list', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ user_id: 'u1', email: 'bob@example.com', run_count: 6, last_active_at: '2026-07-22T00:00:00Z' }],
        }),
      ),
      http.get(`${BASE}/elitea_core/analytics_user_detail/prompt_lib/7`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('user_id')).toBe('u1');
        return HttpResponse.json({ entity_name: '', kpis: {}, agents: [], tools: [], daily_usage: [] });
      }),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, queryByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await user.click(await findByText('bob@example.com'));
    expect(queryByText('User Activity')).not.toBeInTheDocument();
    const backButton = await findByRole('button', { name: 'Back' });
    await user.click(backButton);
    expect(await findByText('User Activity')).toBeInTheDocument();
  });

  it('routes "Back" to onBackToSource instead of the local list when opened via initialUserId (cross-tab navigation)', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () => HttpResponse.json({ items: [] })),
      http.get(`${BASE}/elitea_core/analytics_user_detail/prompt_lib/7`, () =>
        HttpResponse.json({ entity_name: '', kpis: {}, agents: [], tools: [], daily_usage: [] }),
      ),
    );
    const user = userEvent.setup();
    let backToSourceCalls = 0;
    const { findByRole } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
        initialUserId="u1"
        onBackToSource={() => {
          backToSourceCalls += 1;
        }}
      />,
    );
    const backButton = await findByRole('button', { name: 'Back' });
    await user.click(backButton);
    expect(backToSourceCalls).toBe(1);
  });
});
