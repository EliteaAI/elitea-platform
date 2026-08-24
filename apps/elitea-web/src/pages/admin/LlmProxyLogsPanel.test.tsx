/**
 * The LLM Proxy Logs tab.
 *
 * What is pinned is what separates a useful log from a misleading one:
 *
 *  1. **Failures are shown.** They are the reason this tab exists — the Usage
 *     report cannot show them, because only billed requests reach the ledger it
 *     reads.
 *  2. **An empty page is not claimed when the read failed.** "No requests in
 *     this window" would tell an operator investigating an outage that nothing
 *     was even being attempted.
 *  3. **Filters reach the server.** The page is capped there, so narrowing what
 *     was already returned would silently exclude everything past the cap.
 *  4. **Paging is by cursor**, carried verbatim as a string.
 *  5. **The absence of payloads is stated on screen**, so an operator does not
 *     go looking for a request body that cannot exist.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { LlmProxyLogsPanel } from './LlmProxyLogsPanel';
import { renderAdminRoute } from './__tests__/testRouter';

const OK_ROW = {
  id: '1002',
  occurred_at: '2026-08-24T10:00:00Z',
  project_id: 7,
  user_id: 42,
  route: '/llm/v1/chat/completions',
  method: 'POST',
  status: 200,
  duration_ms: 1240,
  provider: 'openai',
  model: 'gpt-4o',
  streaming: true,
  error_code: '',
  prompt_tokens: 900,
  completion_tokens: 100,
};

const REFUSED_ROW = {
  ...OK_ROW,
  id: '1001',
  status: 402,
  duration_ms: 12,
  streaming: false,
  error_code: 'budget_exceeded',
  prompt_tokens: 0,
  completion_tokens: 0,
};

const SUMMARY = { requests: 412, failed: 37, median_ms: 890, p95_ms: 4200 };

function useLogs(body: Record<string, unknown>): void {
  server.use(http.get('*/admin/gateway/logs', () => HttpResponse.json(body)));
}

function page(items: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { items, window: '24h', summary: SUMMARY, retention_days: 30, ...extra };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: 'https://elitea.example' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('LlmProxyLogsPanel', () => {
  it('shows refused requests, which the usage report cannot', async () => {
    useLogs(page([OK_ROW, REFUSED_ROW]));
    renderAdminRoute(<LlmProxyLogsPanel />);

    const table = await screen.findByTestId('llm-logs-table');
    expect(table).toHaveTextContent('gpt-4o');
    // The classification beside the status: "402" alone does not say whether a
    // budget or a policy refused it.
    expect(table).toHaveTextContent('402 budget_exceeded');
  });

  it('reports the window totals, not the page', async () => {
    useLogs(page([OK_ROW]));
    renderAdminRoute(<LlmProxyLogsPanel />);

    const summary = await screen.findByTestId('llm-logs-summary');
    expect(summary).toHaveTextContent('412');
    expect(summary).toHaveTextContent('37');
    // Latency as median and p95 rather than a mean, which over a mix of
    // streamed and buffered responses describes neither.
    expect(summary).toHaveTextContent('890 ms');
    expect(summary).toHaveTextContent('4.20 s');
  });

  it('says that payloads are never recorded', async () => {
    useLogs(page([OK_ROW]));
    renderAdminRoute(<LlmProxyLogsPanel />);

    // Stated once and plainly, so nobody goes looking for a request body that
    // the schema has no column for.
    expect(await screen.findByTestId('llm-logs-no-payload')).toHaveTextContent(
      'never recorded',
    );
  });

  it('does not claim the window is empty when the read failed', async () => {
    useLogs(page([], { error: 'read the request log: query timeout' }));
    renderAdminRoute(<LlmProxyLogsPanel />);

    expect(await screen.findByTestId('llm-logs-error')).toHaveTextContent('query timeout');
    expect(screen.queryByTestId('llm-logs-empty')).toBeNull();
  });

  it('distinguishes "no failures" from "no traffic"', async () => {
    useLogs(page([]));
    renderAdminRoute(<LlmProxyLogsPanel />);
    expect(await screen.findByTestId('llm-logs-empty')).toHaveTextContent('No requests');

    // With the filter on, an empty result is good news and must read that way.
    await userEvent.click(screen.getByRole('switch', { name: 'Failures only' }));
    await waitFor(() => {
      expect(screen.getByTestId('llm-logs-empty')).toHaveTextContent('No failed requests');
    });
  });

  it('keeps the summary failure separate from the page', async () => {
    useLogs(page([OK_ROW], { summary_error: 'summarise the request log: timeout' }));
    renderAdminRoute(<LlmProxyLogsPanel />);

    // The page is still worth showing; a zeroed summary rendered without its
    // reason would read as "no failures in this window".
    expect(await screen.findByTestId('llm-logs-summary-error')).toBeVisible();
    expect(screen.getByTestId('llm-logs-table')).toBeVisible();
  });

  it('sends every filter to the server', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get('*/admin/gateway/logs', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([OK_ROW]));
      }),
    );
    renderAdminRoute(<LlmProxyLogsPanel />);
    await screen.findByTestId('llm-logs-table');

    await userEvent.type(screen.getByTestId('llm-logs-project'), '7');
    await userEvent.type(screen.getByTestId('llm-logs-model'), 'gpt-4o');
    await userEvent.click(screen.getByRole('switch', { name: 'Failures only' }));

    // The page is capped server-side, so narrowing only what was already
    // returned would silently exclude every row past the cap.
    await waitFor(() => {
      const last = queries.at(-1);
      expect(last?.get('project_id')).toBe('7');
      expect(last?.get('model')).toBe('gpt-4o');
      expect(last?.get('failed')).toBe('true');
    });
  });

  it('pages by cursor, carried verbatim', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/admin/gateway/logs', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? page([OK_ROW], { next_cursor: '9007199254740993' })
            : page([REFUSED_ROW]),
        );
      }),
    );
    renderAdminRoute(<LlmProxyLogsPanel />);

    await userEvent.click(await screen.findByTestId('llm-logs-more'));

    await waitFor(() => {
      // Verbatim as a STRING: the id is a BIGSERIAL, and a client that parsed
      // it as a number would lose precision silently at exactly this magnitude.
      expect(cursors).toContain('9007199254740993');
    });
  });

  it('offers no "load older" control on the last page', async () => {
    useLogs(page([OK_ROW]));
    renderAdminRoute(<LlmProxyLogsPanel />);

    await screen.findByTestId('llm-logs-table');
    // An absent next_cursor means this is the end; a button here would fetch
    // the same page forever.
    expect(screen.queryByTestId('llm-logs-more')).toBeNull();
  });

  it('says how far back the log goes', async () => {
    useLogs(page([OK_ROW]));
    renderAdminRoute(<LlmProxyLogsPanel />);

    // Without it, a request older than the window reads as "it never happened"
    // rather than "it is older than the log".
    expect(await screen.findByText(/kept for 30 days/)).toBeVisible();
  });
});
