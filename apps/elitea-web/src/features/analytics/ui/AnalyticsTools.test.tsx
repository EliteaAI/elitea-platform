import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';
import { AnalyticsTools } from './AnalyticsTools';

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

describe('AnalyticsTools', () => {
  it('renders the table with tool rows once the list resolves', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ toolkit_id: 'tk1', tool_name: 'web_search', run_count: 8, avg_duration_ms: 150, error_rate: 0 }],
        }),
      ),
    );
    const { findByText } = renderScreen(
      <AnalyticsTools
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('web_search')).toBeInTheDocument();
  });

  // ── The load-failure branch (issue #303) — see AnalyticsAgents.test.tsx's
  // equivalent pair for the full rationale. The error text alone is not
  // enough: a page rendering error text AND an empty table would pass it.
  it('shows the load error and NO table when the list query fails', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () =>
        HttpResponse.json({ detail: 'analytics: no data source' }, { status: 500 }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsTools
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('Failed to load analytics data.')).toBeVisible();
    expect(queryByText('Tool Details')).not.toBeInTheDocument();
    expect(queryByText('0 tools')).not.toBeInTheDocument();
    for (const header of ['Tool', 'Calls', 'Users', 'Avg Latency', 'Errors']) {
      expect(queryByText(header)).not.toBeInTheDocument();
    }
  });

  // Control: without it, an always-erroring component would look correct.
  it('still renders the table with its headers and count when the list query succeeds', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ toolkit_id: 'tk1', tool_name: 'web_search', run_count: 8, avg_duration_ms: 150, error_rate: 0 }],
        }),
      ),
    );
    const { findByText, getByText, queryByText } = renderScreen(
      <AnalyticsTools
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('web_search')).toBeVisible();
    expect(getByText('1 tools')).toBeVisible();
    for (const header of ['Tool', 'Calls', 'Users', 'Avg Latency', 'Errors']) {
      expect(getByText(header)).toBeVisible();
    }
    expect(queryByText('Failed to load analytics data.')).not.toBeInTheDocument();
  });

  it('renders a real error_rate fraction scaled ×100 as a percentage, not the raw fraction (the 100x display defect fix)', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ toolkit_id: 'tk1', tool_name: 'web_search', run_count: 8, avg_duration_ms: 150, error_rate: 0.2 }],
        }),
      ),
    );
    const { findByText, queryByText } = renderScreen(
      <AnalyticsTools
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    expect(await findByText('20.0%')).toBeInTheDocument();
    expect(queryByText('0.2%')).not.toBeInTheDocument();
  });

  it("drills into AnalyticsToolDetailed sending toolkit_id (the defect fix), not tool_id or tool_name", async () => {
    server.use(
      http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () =>
        HttpResponse.json({
          items: [{ toolkit_id: 'tk1', tool_name: 'web_search', run_count: 8, avg_duration_ms: 150, error_rate: 0 }],
        }),
      ),
      http.get(`${BASE}/elitea_core/analytics_tool_detail/prompt_lib/7`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('toolkit_id')).toBe('tk1');
        expect(url.searchParams.has('tool_id')).toBe(false);
        expect(url.searchParams.has('tool_name')).toBe(false);
        return HttpResponse.json({ entity_name: '', kpis: {}, users: [], agents: [], daily_usage: [] });
      }),
    );
    const user = userEvent.setup();
    const { findByText, findByRole, queryByText } = renderScreen(
      <AnalyticsTools
        projectId="7"
        dateFrom={RANGE.dateFrom}
        dateTo={RANGE.dateTo}
      />,
    );
    await user.click(await findByText('web_search'));
    expect(queryByText('Tool Details')).not.toBeInTheDocument();
    // The stub `entity_name` is "" — the detail heading falls back to the
    // already-known `toolName` from the clicked row (see
    // AnalyticsToolDetailed's own header comment).
    expect(await findByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
