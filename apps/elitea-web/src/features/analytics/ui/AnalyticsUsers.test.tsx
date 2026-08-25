import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
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

  // ── The load-failure branch (issue #303) — see AnalyticsAgents.test.tsx's
  // equivalent pair. Asserting the error text alone would pass against a
  // page rendering the error AND the empty table, so the eight column
  // headers and the count label are asserted absent too.
  it('shows the load error and NO table when the list query fails', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({ detail: 'analytics: no data source' }, { status: 500 }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('Failed to load analytics data.')).toBeVisible();
    expect(queryByText('User Activity')).not.toBeInTheDocument();
    expect(queryByText('0 users')).not.toBeInTheDocument();
    for (const header of ['User', 'Events', 'Days', 'LLM', 'Tool', 'Agent', 'Chat Msg', 'Errors']) {
      expect(queryByText(header)).not.toBeInTheDocument();
    }
  });

  // Control: without it, an always-erroring component would look correct.
  it('still renders the table with its headers and count when the list query succeeds', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ user_id: 'u1', email: 'bob@example.com', run_count: 6, last_active_at: '2026-07-22T00:00:00Z' }],
        }),
      ),
    );
    const { findByText, getByText, queryByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('bob@example.com')).toBeVisible();
    expect(getByText('1 users')).toBeVisible();
    for (const header of ['User', 'LLM calls', 'Tokens', 'Last active']) {
      expect(getByText(header)).toBeVisible();
    }
    expect(queryByText('Failed to load analytics data.')).not.toBeInTheDocument();
  });

  // The `isError` guard sits AFTER the drill-down branch on purpose: a user
  // arriving from the Overview leaderboard (`initialUserId`) is already
  // inside the detail screen, whose only exit is its Back button. Replacing
  // that screen with a bare error message over a failure of the LIST query
  // would strand them there.
  it('keeps the drill-down (and its Back route) usable when the LIST query fails', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({ detail: 'analytics: no data source' }, { status: 500 }),
      ),
      http.get(`${BASE}/elitea_core/analytics_user_detail/prompt_lib/7`, () =>
        HttpResponse.json({ entity_name: '', kpis: {}, agents: [], tools: [], daily_usage: [] }),
      ),
    );
    const user = userEvent.setup();
    let backToSourceCalls = 0;
    const { findByRole, queryByText } = renderScreen(
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
    expect(queryByText('Failed to load analytics data.')).not.toBeInTheDocument();
    await user.click(backButton);
    expect(backToSourceCalls).toBe(1);
  });

  /**
   * The six dash columns (Days/LLM/Tool/Agent/Chat Msg/Errors) were baseline
   * headers over cells that rendered a dash in every row, forever — no
   * per-type breakdown exists on this type and none exists in the gateway
   * request log it now reads. They were removed rather than kept as parity
   * decoration: six columns of dashes take three quarters of the table's width
   * to say nothing, and read as breakage.
   */
  it('renders real figures in every column, with no dash placeholders left', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [
            {
              user_id: 'u1',
              email: 'bob@example.com',
              run_count: 6,
              total_tokens: 2500,
              last_active_at: '2026-07-22T00:00:00Z',
            },
          ],
        }),
      ),
    );
    const { findByText, getByText, queryAllByText, queryByText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await findByText('bob@example.com');
    expect(getByText('6')).toBeVisible();
    expect(getByText('2.5K')).toBeVisible();
    expect(queryAllByText('–')).toHaveLength(0);
    for (const goneHeader of ['Days', 'Chat Msg', 'Errors']) {
      expect(queryByText(goneHeader)).not.toBeInTheDocument();
    }
  });

  /** A display name, when the identity join produced one, beats the email. */
  it('prefers the display name over the email', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [
            {
              user_id: 'u1',
              email: 'bob@example.com',
              name: 'Bob B.',
              run_count: 6,
              total_tokens: 10,
              last_active_at: '2026-07-22T00:00:00Z',
            },
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
    expect(await findByText('Bob B.')).toBeVisible();
    expect(queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  /**
   * The identity tables belong to another corpus and can be absent, in which
   * case the server sends an EMPTY email rather than dropping the row — the
   * count is still useful. The cell must fall back to the id, not go blank.
   */
  it('falls back to the user id when the identity join produced nothing', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [
            {
              user_id: '41',
              email: '',
              run_count: 6,
              total_tokens: 10,
              last_active_at: '2026-07-22T00:00:00Z',
            },
          ],
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
    expect(await findByText('User 41')).toBeVisible();
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

describe('AnalyticsUsers truncation', () => {
  /**
   * A cut list must not read as the whole one. The count label and the
   * pagination footer are both computed from what ARRIVED, so without the
   * server's flag the busiest N callers are presented as the entire
   * membership — with a plausible count and working pagination, and nothing on
   * screen or in the client able to tell the difference.
   */
  it('says the list is a top-N when the server reports it cut one', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          truncated: true,
          items: [
            {
              user_id: 'u1',
              email: 'bob@example.com',
              run_count: 6,
              total_tokens: 10,
              last_active_at: '2026-07-22T00:00:00Z',
            },
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
    expect(await findByText('Top 1 users by LLM calls')).toBeVisible();
    expect(queryByText('1 users')).not.toBeInTheDocument();
  });

  it('reports a plain count when the list is complete', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          truncated: false,
          items: [
            {
              user_id: 'u1',
              email: 'bob@example.com',
              run_count: 6,
              total_tokens: 10,
              last_active_at: '2026-07-22T00:00:00Z',
            },
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
    expect(await findByText('1 users')).toBeVisible();
    expect(queryByText(/^Top /)).not.toBeInTheDocument();
  });

  /** Search matches what the column DISPLAYS, not only the email. */
  it('finds a member by their display name', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () =>
        HttpResponse.json({
          truncated: false,
          items: [
            {
              user_id: 'u1',
              email: '',
              name: 'Carol C.',
              run_count: 6,
              total_tokens: 10,
              last_active_at: '2026-07-22T00:00:00Z',
            },
            {
              user_id: 'u2',
              email: 'dave@example.com',
              run_count: 1,
              total_tokens: 2,
              last_active_at: '2026-07-22T00:00:00Z',
            },
          ],
        }),
      ),
    );
    const { findByText, queryByText, findByPlaceholderText } = renderScreen(
      <AnalyticsUsers
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await findByText('Carol C.');
    await userEvent.type(await findByPlaceholderText('Search users'), 'carol');
    // `SimpleSearchBar` debounces, so the non-matching row leaves the table a
    // beat after the keystrokes land — asserting its absence immediately would
    // pass for the wrong reason on a slow run and fail on a fast one.
    await waitFor(() => {
      expect(queryByText('dave@example.com')).not.toBeInTheDocument();
    });
    expect(await findByText('Carol C.')).toBeVisible();
  });
});
