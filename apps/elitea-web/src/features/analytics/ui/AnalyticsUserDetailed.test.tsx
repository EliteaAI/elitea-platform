import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsUserDetailed, dailyActivityPoints } from './AnalyticsUserDetailed';

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

describe('dailyActivityPoints', () => {
  it('reads the llm/tool/chat/agent per-type breakdown, not the generic events/errors shape', () => {
    const rows = [
      { date: '2026-07-20', llm: 3, tool: 5, chat: 2, agent: 1, events: 999, errors: 999 },
      { date: '2026-07-21', llm: 0, tool: 0, chat: 0, agent: 0 },
    ];
    expect(dailyActivityPoints(rows)).toEqual([
      { date: '2026-07-20', llm: 3, tool: 5, chat: 2, agent: 1 },
      { date: '2026-07-21', llm: 0, tool: 0, chat: 0, agent: 0 },
    ]);
  });

  it('defaults every count field to 0 and the date to "" for rows missing them', () => {
    expect(dailyActivityPoints([{}])).toEqual([{ date: '', llm: 0, tool: 0, chat: 0, agent: 0 }]);
  });
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

  it('renders the user-detail-specific Daily Activity chart (title + "Events by type per day" subtitle) when daily_usage has rows', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({
          entity_name: 'a@x.com',
          kpis: ZERO_KPIS,
          agents: [],
          tools: [],
          daily_usage: [{ date: '2026-07-20', llm: 3, tool: 5, chat: 2, agent: 1 }],
        }),
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
    expect(await findByText('Daily Activity')).toBeInTheDocument();
    // The generic Agent/Tool Detailed chart (`ui/components/DailyUsageChart`)
    // never renders a subtitle at all — this text only exists on this
    // screen's own per-type chart, so its presence proves the fix is wired
    // in, not just that SOME chart with a "Daily Activity" title rendered.
    expect(getByText('Events by type per day')).toBeInTheDocument();
  });

  it('renders no Daily Activity chart when daily_usage is empty (matches the shared chart siblings empty behaviour)', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ entity_name: 'a@x.com', kpis: ZERO_KPIS, agents: [], tools: [], daily_usage: [] }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
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
    expect(queryByText('Daily Activity')).not.toBeInTheDocument();
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
