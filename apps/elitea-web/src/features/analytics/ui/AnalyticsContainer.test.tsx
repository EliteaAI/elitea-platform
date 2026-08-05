import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsContainer } from './AnalyticsContainer';

const BASE = '/api/v2';
const USAGE_URL = `${BASE}/elitea_core/analytics/prompt_lib/7`;

function renderScreen(ui: ReactElement): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithTheme(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// `llm_calls` deliberately renders (via `fmtNum`) as "4.3K", not a raw
// 1-2 digit number — the real `AnalyticsContainer` embeds a REAL, live
// `DateTimePicker` showing the actual current wall-clock date/time, whose
// day/hour/minute spinbutton sections are also plain 1-2 digit text nodes
// in the same document; a small KPI number risks colliding with whatever
// the clock happens to read at the moment the test runs (a real flake
// this suite hit once: `llm_calls: 42` collided with a "42" minutes
// value). A four-digit, K-formatted value can't collide with any
// day (≤31), hour (≤23), minute/second (≤59), or month field.
function usageResponse(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kpis: {
      unique_users: 5,
      total_project_users: 10,
      ai_active_users: 3,
      adoption_rate: 30,
      llm_calls: 4321,
      tool_runs: 7,
      chat_msgs: 100,
      agent_runs: 9,
    },
    top_ai_users: [],
    daily_activity: [],
    models: [],
    ...overrides,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AnalyticsContainer', () => {
  it('renders the header title', () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const { getByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    expect(getByText('Analytics')).toBeInTheDocument();
  });

  it('renders the project label when projectName is provided', () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const { getByText } = renderScreen(
      <AnalyticsContainer
        projectId="7"
        projectName="Demo Project"
      />,
    );
    expect(getByText('Project: Demo Project')).toBeInTheDocument();
  });

  it('omits the project label when projectName is not provided', () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const { queryByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    expect(queryByText(/^Project:/)).not.toBeInTheDocument();
  });

  it('fetches and renders Overview KPIs by default', async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const { findByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    expect(await findByText('4.3K')).toBeInTheDocument();
  });

  it('shows the load-error message when the usage query fails', async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const { findByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    expect(await findByText('Failed to load analytics data.')).toBeInTheDocument();
  });

  it('switches to the Agents tab and renders its content', async () => {
    server.use(
      http.get(USAGE_URL, () => HttpResponse.json(usageResponse())),
      http.get(`${BASE}/elitea_core/analytics_agents/prompt_lib/7`, () => HttpResponse.json({ items: [] })),
    );
    const user = userEvent.setup();
    const { getByRole, findByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    await user.click(getByRole('tab', { name: 'Agents' }));
    expect(await findByText('Agent Activity')).toBeInTheDocument();
  });

  it('switches to the Guide tab (no data fetch needed)', async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const user = userEvent.setup();
    const { getByRole, findByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    await user.click(getByRole('tab', { name: 'Guide' }));
    expect(await findByText('Overview Tab')).toBeInTheDocument();
  });

  it('switches to the Health tab and renders once usage data resolves', async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const user = userEvent.setup();
    const { getByRole, findByText } = renderScreen(<AnalyticsContainer projectId="7" />);
    await user.click(getByRole('tab', { name: 'Health' }));
    expect(await findByText('No health data available.')).toBeInTheDocument();
  });

  it('navigates from the Overview leaderboard to the Users tab with the clicked user preselected', async () => {
    server.use(
      http.get(USAGE_URL, () =>
        HttpResponse.json(
          usageResponse({
            top_ai_users: [{ user_id: 'u1', user_email: 'alice@example.com', llm_calls: 1, tool_runs: 1, agent_runs: 1, ai_events: 3 }],
          }),
        ),
      ),
      http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () => HttpResponse.json({ items: [] })),
      http.get(`${BASE}/elitea_core/analytics_user_detail/prompt_lib/7`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('user_id')).toBe('u1');
        return HttpResponse.json({ entity_name: 'alice@example.com', kpis: usageResponse().kpis, agents: [], tools: [], daily_usage: [] });
      }),
    );
    const user = userEvent.setup();
    const { findByText, getByRole } = renderScreen(<AnalyticsContainer projectId="7" />);
    await user.click(await findByText('alice@example.com'));
    // Landed directly on the User Detail screen (Users tab is now active,
    // and the clicked user is preselected via `pendingUserId`).
    expect(getByRole('tab', { name: 'Users', selected: true })).toBeInTheDocument();
    expect(await findByText('alice@example.com')).toBeInTheDocument();
  });

  it('changes the date-range preset selection', async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json(usageResponse())));
    const user = userEvent.setup();
    const { getByRole } = renderScreen(<AnalyticsContainer projectId="7" />);
    const sevenDayButton = getByRole('button', { name: 'Last 7d' });
    await user.click(sevenDayButton);
    expect(sevenDayButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not fetch while projectId is undefined (a genuine Wave-1 gap — see this component\'s header)', () => {
    let hit = false;
    server.use(
      http.get(`${BASE}/elitea_core/analytics/prompt_lib/*`, () => {
        hit = true;
        return HttpResponse.json(usageResponse());
      }),
    );
    renderScreen(<AnalyticsContainer projectId={undefined} />);
    expect(hit).toBe(false);
  });
});
