/**
 * The container's whole job is gating plus one query, so this exercises the
 * real `contextManagementApi` route through msw rather than mocking the hook:
 * a widget that fetches from the wrong URL would still pass a mocked test.
 */
import type { ReactElement } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ContextBudget } from './ContextBudget';

const BASE = '/api/v2';
const STATUS_URL = `${BASE}/elitea_core/context_analytics/prompt_lib/7/42`;

/** `eliteaFetch` returns a `{data,status,headers}` envelope whose `data` IS the JSON body, so the handler serves the body unwrapped. */
const STATUS_BODY = {
  current_tokens: 12000,
  max_tokens: 128000,
  message_groups_in_context: 9,
  strategy_name: 'sliding_window',
  context_analytics: { summaries_generated: 2 },
};

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('ContextBudget', () => {
  it('renders the panel from the conversation-scoped context status', async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json(STATUS_BODY)));

    const { findByTestId } = renderWithTheme(wrap(<ContextBudget conversationId="42" projectId="7" />));

    expect((await findByTestId('context-budget-tokens')).textContent).toContain('tokens');
    expect((await findByTestId('context-budget-stat-summaries')).textContent).toBe('Summaries:2');
  });

  it.each([
    ['no conversation (new or playback chat)', { projectId: '7' }],
    ['no project', { conversationId: '42' }],
    ['an empty conversation id', { conversationId: '', projectId: '7' }],
  ])('renders nothing and issues no request with %s', async (_label, props) => {
    const handler = vi.fn(() => HttpResponse.json(STATUS_BODY));
    server.use(http.get(`${BASE}/elitea_core/context_analytics/prompt_lib/*`, handler));

    const { container } = renderWithTheme(wrap(<ContextBudget {...props} />));

    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('renders nothing when the status request fails', async () => {
    server.use(http.get(STATUS_URL, () => new HttpResponse(null, { status: 500 })));

    const { container } = renderWithTheme(wrap(<ContextBudget conversationId="42" projectId="7" />));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="context-budget-panel"]')).toBeNull();
    });
  });
});
