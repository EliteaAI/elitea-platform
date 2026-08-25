import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectAnalytics } from '@/shared/api/generated/model';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../../test/setup';
import { AnalyticsTabContent } from './AnalyticsTabContent';

const BASE = '/api/v2';

const DATA: ProjectAnalytics = {
  kpis: {
    total_project_users: 2,
    ai_active_users: 1,
    adoption_rate: 50,
    llm_calls: 1,
    total_tokens: 33,
  },
  top_ai_users: [],
  daily_activity: [],
  models: [],
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

const NOOP = (): void => {};

describe('AnalyticsTabContent', () => {
  it('shows a spinner while needsOverview and isFetching are both true', () => {
    const { getByRole } = renderScreen(
      <AnalyticsTabContent
        activeTab={0}
        needsOverview
        isFetching
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the error message when needsOverview and isError are both true', () => {
    const { getByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={0}
        needsOverview
        isFetching={false}
        isError
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(getByText('Failed to load analytics data.')).toBeInTheDocument();
  });

  it('renders null for the Overview tab when data is undefined but not loading/erroring', () => {
    const { container } = renderScreen(
      <AnalyticsTabContent
        activeTab={0}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders AnalyticsOverview for tab 0 when data is present', () => {
    const { getByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={0}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={DATA}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(getByText('AI ACTIVE')).toBeInTheDocument();
  });

  it('renders AnalyticsAgents for tab 1', async () => {
    server.use(http.get(`${BASE}/elitea_core/analytics_agents/prompt_lib/7`, () => HttpResponse.json({ items: [] })));
    const { findByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={1}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(await findByText('Agent Activity')).toBeInTheDocument();
  });

  it('renders AnalyticsTools for tab 2', async () => {
    server.use(http.get(`${BASE}/elitea_core/analytics_tools/prompt_lib/7`, () => HttpResponse.json({ items: [] })));
    const { findByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={2}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(await findByText('Tool Details')).toBeInTheDocument();
  });

  it('renders AnalyticsUsers for tab 3', async () => {
    server.use(http.get(`${BASE}/elitea_core/analytics_users/prompt_lib/7`, () => HttpResponse.json({ items: [] })));
    const { findByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={3}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(await findByText('User Activity')).toBeInTheDocument();
  });

  it('renders null for tab 4 (Health) when data is undefined', () => {
    const { container } = renderScreen(
      <AnalyticsTabContent
        activeTab={4}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders AnalyticsHealth for tab 4 when data is present', () => {
    const { getByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={4}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={DATA}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(getByText('No health data available.')).toBeInTheDocument();
  });

  it('renders AnalyticsGuide for tab 5', () => {
    const { getByText } = renderScreen(
      <AnalyticsTabContent
        activeTab={5}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(getByText('Overview Tab')).toBeInTheDocument();
  });

  it('renders null for an out-of-range tab index (defensive default branch)', () => {
    const { container } = renderScreen(
      <AnalyticsTabContent
        activeTab={99}
        needsOverview={false}
        isFetching={false}
        isError={false}
        data={undefined}
        projectId="7"
        dateFrom=""
        dateTo=""
        pendingUserId={null}
        onUserClick={NOOP}
        onBackToSource={NOOP}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
