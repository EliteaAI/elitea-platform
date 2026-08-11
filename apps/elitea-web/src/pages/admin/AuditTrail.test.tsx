/**
 * Rendering + query-path guard for `pages/admin/AuditTrail.tsx` (unit A14).
 *
 * `pages/settings/Users.tsx` had NO rendering test before #130, which is how a
 * totally-empty members table shipped. This page is a pure READ surface, so the
 * "write reaches the server" assertions its Users twin makes have no analogue —
 * the equivalent risk here is a page that renders beautifully off the WRONG
 * query, or off no query at all. Two of its four endpoints were empty stubs
 * until this unit, and one of them answered with an `items` key the client has
 * never read, so "something rendered" is not evidence of anything.
 *
 * Accordingly every case below asserts BOTH halves: what the server was asked,
 * and what came back onto the screen.
 *
 * No fixture here carries a real user's data; the emails are autotest ones.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { AdminAuditTrail } from './AuditTrail';
import { renderAdminRoute } from './__tests__/testRouter';

/** Measured against the Go handler: `{rows,total}`, one row per trace. */
const TRACES_BODY = {
  rows: [
    {
      trace_id: 'trace-alpha',
      start_time: '2026-03-04T10:00:00Z',
      duration_ms: 3500,
      span_count: 3,
      error_count: 1,
      has_error: true,
      user_email: 'ada@autotest.local',
      project_id: 1,
      event_types: ['api', 'llm', 'tool'],
      root_action: 'POST /chat',
      root_event_type: 'api',
      root_http_method: 'POST',
      root_status_code: 200,
    },
    {
      trace_id: 'trace-beta',
      start_time: '2026-03-04T10:01:00Z',
      duration_ms: 45,
      span_count: 1,
      error_count: 0,
      has_error: false,
      user_email: 'bo@autotest.local',
      project_id: 2,
      event_types: ['api'],
      root_action: 'GET /agents',
      root_event_type: 'api',
      root_http_method: 'GET',
      root_status_code: 200,
    },
  ],
  total: 2,
};

/** One row per `centry.audit_events` row — every field a real column. */
const SPANS_BODY = {
  rows: [
    {
      id: 91,
      timestamp: '2026-03-04T10:00:00Z',
      user_id: 7,
      user_email: 'ada@autotest.local',
      project_id: 1,
      event_type: 'llm',
      action: 'completion',
      http_method: null,
      http_route: null,
      status_code: 503,
      duration_ms: 2000,
      is_error: true,
      entity_name: null,
      tool_name: null,
      model_name: 'gpt-4o',
      trace_id: 'trace-alpha',
      span_id: 'span-1',
      parent_span_id: 'root',
    },
    {
      id: 92,
      timestamp: '2026-03-04T10:00:01Z',
      user_id: 7,
      user_email: 'ada@autotest.local',
      project_id: 1,
      event_type: 'api',
      action: 'GET /agents',
      http_method: 'GET',
      http_route: '/agents',
      status_code: 200,
      duration_ms: 12,
      is_error: false,
      entity_name: null,
      tool_name: null,
      model_name: null,
      // No trace: the action must NOT be rendered as a drill-down link.
      trace_id: null,
      span_id: null,
      parent_span_id: null,
    },
  ],
  total: 2,
};

/**
 * A 3-bucket × 5-band chart. `interval_seconds` is what turns a clicked cell
 * back into a time range, so it is load-bearing rather than decoration.
 */
const BUCKET_START = 1772618400; // 2026-03-04T10:00:00Z
const BUCKET_SECONDS = 60;

function heatmapBody(totalKey: 'total_events' | 'total_traces') {
  const buckets = [BUCKET_START, BUCKET_START + BUCKET_SECONDS, BUCKET_START + 2 * BUCKET_SECONDS];
  const bands = ['>10s', '1-10s', '100ms-1s', '10-100ms', '<10ms'];
  return {
    data: bands.map((band) => ({
      id: band,
      data: buckets.map((bucket, index) => ({
        // Exactly one populated cell in the whole chart: the middle bucket of
        // the 1-10s band. Everything else is null, so a drill-down assertion
        // cannot pass by clicking the wrong cell.
        x: bucket,
        y: band === '1-10s' && index === 1 ? 4 : null,
      })),
    })),
    metadata: {
      interval_seconds: BUCKET_SECONDS,
      interval_label: '1min',
      bucket_count: buckets.length,
      range_seconds: 1800,
      [totalKey]: 4,
    },
  };
}

interface RecordedRequest {
  readonly path: string;
  readonly url: URL;
}

let recorded: RecordedRequest[] = [];

function record(request: Request, path: string): void {
  recorded.push({ path, url: new URL(request.url) });
}

function requestsTo(path: string): RecordedRequest[] {
  return recorded.filter((entry) => entry.path === path);
}

function lastRequestTo(path: string): RecordedRequest | undefined {
  return requestsTo(path).at(-1);
}

function useAuditHandlers(): void {
  server.use(
    http.get('*/elitea_core/audit/administration', ({ request }) => {
      record(request, 'audit');
      return HttpResponse.json(SPANS_BODY);
    }),
    http.get('*/elitea_core/audit_traces/administration', ({ request }) => {
      record(request, 'audit_traces');
      return HttpResponse.json(TRACES_BODY);
    }),
    http.get('*/elitea_core/audit_heatmap/administration', ({ request }) => {
      record(request, 'audit_heatmap');
      return HttpResponse.json(heatmapBody('total_events'));
    }),
    http.get('*/elitea_core/audit_trace_heatmap/administration', ({ request }) => {
      record(request, 'audit_trace_heatmap');
      return HttpResponse.json(heatmapBody('total_traces'));
    }),
  );
}

/** The permission list the Go adminui handler injects for a valid session. */
function grantAdminUiPermissions(permissions: string[]): void {
  window.admin_ui_config = { permissions, vite_server_url: '/api/v2' };
}

async function switchToSpans(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('tab', { name: 'Spans' }));
  await screen.findByText('completion [gpt-4o]');
}

beforeEach(() => {
  recorded = [];
  configureGeneratedClient({ baseUrl: '/api/v2' });
  grantAdminUiPermissions(['models.admin.audit_trail.view']);
  useAuditHandlers();
});

afterEach(() => {
  resetGeneratedClient();
  delete window.admin_ui_config;
});

describe('Admin › Audit Trail', () => {
  it('renders one row per trace from the {rows,total} body, with the aggregate the server computed', async () => {
    renderAdminRoute(<AdminAuditTrail />);

    expect(await screen.findByText('POST /chat')).toBeInTheDocument();
    expect(screen.getByText('GET /agents')).toBeInTheDocument();
    expect(screen.getAllByTestId('audit-trace-row')).toHaveLength(2);
    expect(screen.queryByText('No traces found')).not.toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Audit traces' });
    expect(within(table).getByText('ada@autotest.local')).toBeInTheDocument();

    // The trace's own wall-clock duration, formatted — not a span's, and not
    // the raw millisecond number.
    expect(within(table).getByText('3.5s')).toBeInTheDocument();
    expect(within(table).getByText('45ms')).toBeInTheDocument();

    // span_count comes from the server's aggregate. Deriving it from the
    // (lazy, unexpanded) span panel would report 0 for every row.
    expect(within(table).getByText('3')).toBeInTheDocument();

    expect(screen.getByText('1–2 / 2')).toBeInTheDocument();
  });

  it('asks the TRACE endpoints in the traces view, and the SPAN endpoints in the spans view', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    // Traces view: the grouped listing and the trace heatmap. The span
    // endpoints must not be touched — they count different things, and one
    // trace of five spans is one row here and five there.
    expect(requestsTo('audit_traces')).not.toHaveLength(0);
    expect(requestsTo('audit_trace_heatmap')).not.toHaveLength(0);
    expect(requestsTo('audit')).toHaveLength(0);
    expect(requestsTo('audit_heatmap')).toHaveLength(0);

    await switchToSpans(user);

    expect(requestsTo('audit')).not.toHaveLength(0);
    expect(requestsTo('audit_heatmap')).not.toHaveLength(0);
  });

  it('renders spans with their real columns, and links only the ones that have a trace', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');
    await switchToSpans(user);

    expect(screen.getAllByTestId('audit-span-row')).toHaveLength(2);

    const table = screen.getByRole('table', { name: 'Audit events' });
    // status_code is read from the row. The admin Users reference page rendered
    // a chip off a column that does not exist, so it showed one constant for
    // every row; both distinct codes here have to appear.
    expect(within(table).getByText('503')).toBeInTheDocument();
    expect(within(table).getByText('200')).toBeInTheDocument();
    expect(within(table).getByText('2.0s')).toBeInTheDocument();
    expect(within(table).getByText('12ms')).toBeInTheDocument();

    // A span with a trace drills down; one without is plain text, not a link
    // that would go nowhere.
    expect(screen.getByRole('button', { name: 'completion [gpt-4o]' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'GET /agents' })).not.toBeInTheDocument();
    expect(within(table).getByText('GET /agents')).toBeInTheDocument();
  });

  it('expands a trace by fetching only that trace’s spans', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    // Nothing is fetched for a collapsed trace: the panel is lazy, and eagerly
    // loading every trace's spans is a second query per row.
    expect(requestsTo('audit')).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: 'Expand trace' })[0]!);

    await waitFor(() => expect(screen.getAllByTestId('audit-trace-span-row')).toHaveLength(2));
    const spanRequest = lastRequestTo('audit');
    expect(spanRequest?.url.searchParams.get('trace_id')).toBe('trace-alpha');
    // Ascending, so the spans read in the order they happened rather than in
    // the listing's newest-first order.
    expect(spanRequest?.url.searchParams.get('sort_order')).toBe('asc');
  });

  it('drills the tables into the exact bucket and duration band of a clicked heatmap cell', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    // Only populated cells are buttons: an empty cell has nothing to drill
    // into, and a chart of no-op buttons is the "dead control" defect at scale.
    const cells = within(screen.getByTestId('audit-heatmap')).getAllByRole('button');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAccessibleName(expect.stringContaining('4 traces'));

    await user.click(cells[0]!);

    await waitFor(() => {
      const query = lastRequestTo('audit_traces')?.url.searchParams;
      // The band's millisecond bounds, from DURATION_BANDS.
      expect(query?.get('duration_min')).toBe('1000');
      expect(query?.get('duration_max')).toBe('10000');
      // The bucket's own window: its start, and its start + interval_seconds
      // taken from the server's metadata rather than guessed.
      expect(query?.get('date_from')).toBe(new Date((BUCKET_START + BUCKET_SECONDS) * 1000).toISOString());
      expect(query?.get('date_to')).toBe(new Date((BUCKET_START + 2 * BUCKET_SECONDS) * 1000).toISOString());
    });

    // And the drill-down is visible and removable, rather than silently
    // shrinking the table. The chip names the band it filtered to.
    const chip = await screen.findByText((content) => content.endsWith('· 1-10s'));
    expect(chip).toBeInTheDocument();
    // …and it carries a delete affordance, so the drill-down can be undone
    // without reloading the page.
    expect(within(chip.parentElement!).getByTestId('CancelIcon')).toBeInTheDocument();
  });

  it('asks the server for the search term rather than filtering the loaded page', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    await user.type(screen.getByPlaceholderText('Search actions, tools, users'), 'completion');

    // The listing is paginated server-side over millions of rows, so a
    // client-side filter would only ever search the 50 already loaded.
    await waitFor(
      () => expect(lastRequestTo('audit_traces')?.url.searchParams.get('search')).toBe('completion'),
      { timeout: 3000 },
    );
    // The chart has to move with it, or it describes a different query than the
    // table underneath it.
    await waitFor(() =>
      expect(lastRequestTo('audit_trace_heatmap')?.url.searchParams.get('search')).toBe('completion'),
    );
  });

  it('asks for the system event types on the System tab, and the user ones on the User tab', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    expect(lastRequestTo('audit_traces')?.url.searchParams.get('event_type')).toBe(
      'api,socketio,rpc,agent,tool,llm',
    );

    await user.click(screen.getByRole('tab', { name: 'System' }));

    await waitFor(() =>
      expect(lastRequestTo('audit_traces')?.url.searchParams.get('event_type')).toBe('schedule,admin_task'),
    );
  });

  it('sorts on the server, and resets the sort column when the view changes', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    expect(lastRequestTo('audit_traces')?.url.searchParams.get('sort_by')).toBe('start_time');

    await user.click(screen.getByRole('button', { name: 'Duration' }));
    await waitFor(() => {
      const query = lastRequestTo('audit_traces')?.url.searchParams;
      expect(query?.get('sort_by')).toBe('duration_ms');
      expect(query?.get('sort_order')).toBe('desc');
    });

    // Same column again flips the direction rather than re-sending `desc`.
    await user.click(screen.getByRole('button', { name: 'Duration' }));
    await waitFor(() =>
      expect(lastRequestTo('audit_traces')?.url.searchParams.get('sort_order')).toBe('asc'),
    );

    // `start_time` is not a column the SPAN endpoint's allow-list accepts, so
    // carrying it across would silently fall back on the server.
    await switchToSpans(user);
    await waitFor(() => expect(lastRequestTo('audit')?.url.searchParams.get('sort_by')).toBe('timestamp'));
  });

  it('applies a draft filter only when Apply is pressed', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    await user.type(screen.getByLabelText('Project'), '42');

    // Typing alone must not re-query: this is the largest table in the product
    // and one scan per keystroke is the reason the reference page has an Apply
    // button at all.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastRequestTo('audit_traces')?.url.searchParams.get('project_id')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastRequestTo('audit_traces')?.url.searchParams.get('project_id')).toBe('42'),
    );
  });

  it('refetches when Refresh is pressed, rather than re-rendering the cached answer', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    const before = requestsTo('audit_traces').length;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    // The filters are unchanged, so without a cache-busting key react-query
    // would serve the same answer and the button would do nothing visible.
    await waitFor(() => expect(requestsTo('audit_traces').length).toBeGreaterThan(before));
  });

  it('reports a failed read instead of rendering it as an empty trail', async () => {
    server.use(
      http.get('*/elitea_core/audit_traces/administration', () =>
        HttpResponse.json({ error: 'failed to query audit traces' }, { status: 500 }),
      ),
    );
    renderAdminRoute(<AdminAuditTrail />);

    // "This deployment has no audit history" and "the query blew up" must not
    // render identically — the reassuring one is always the wrong guess.
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the audit trail.');
    expect(screen.queryByText('No traces found')).not.toBeInTheDocument();
  });

  it('renders an empty trail as an empty state, not as an error', async () => {
    server.use(
      http.get('*/elitea_core/audit_traces/administration', () =>
        HttpResponse.json({ rows: [], total: 0 }),
      ),
    );
    renderAdminRoute(<AdminAuditTrail />);

    expect(await screen.findByText('No traces found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops the chart caption rather than guessing a bucket width when metadata is unusable', async () => {
    server.use(
      http.get('*/elitea_core/audit_trace_heatmap/administration', () =>
        HttpResponse.json({ data: heatmapBody('total_traces').data, metadata: { interval_label: '1min' } }),
      ),
    );
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    // Without `interval_seconds` a clicked cell cannot be turned into an honest
    // time range, so the chart is withheld instead of offering a drill-down
    // that would land on the wrong window.
    expect(await screen.findByText('No activity to chart for this range.')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-heatmap')).not.toBeInTheDocument();
    // The TABLE is unaffected — one failed read must not blank the page.
    expect(screen.getByText('POST /chat')).toBeInTheDocument();
  });

  it('sends both date bounds, which the heatmap endpoints reject a request without', async () => {
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    const query = lastRequestTo('audit_trace_heatmap')?.url.searchParams;
    expect(query?.get('date_from')).toBeTruthy();
    expect(query?.get('date_to')).toBeTruthy();
    // The default preset is "Today", so the window is the current local day.
    expect(new Date(query?.get('date_from') ?? '').getTime()).toBeLessThan(
      new Date(query?.get('date_to') ?? '').getTime(),
    );
  });

  it('pages on the server, and offers no next page past the last one', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAuditTrail />);
    await screen.findByText('POST /chat');

    // total 2 with a page size of 50 ⇒ one page.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Rows' }));
    await user.click(await screen.findByRole('option', { name: '20' }));

    await waitFor(() => expect(lastRequestTo('audit_traces')?.url.searchParams.get('limit')).toBe('20'));
    expect(lastRequestTo('audit_traces')?.url.searchParams.get('offset')).toBe('0');
  });
});
