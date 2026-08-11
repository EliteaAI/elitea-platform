/**
 * Rendering and behaviour tests for `pages/admin/AppRequests.tsx` (unit A14).
 *
 * The bar is not "the page renders". Every endpoint behind this page answered
 * 200 before this unit while doing nothing, so a screenshot proved nothing;
 * each test below asserts one of:
 *
 *  - the REQUEST the control produced. An approve button that sends the wrong
 *    id, or that smuggles a field the server refuses, looks identical on screen
 *    to one that does not — and this write notifies a real person.
 *  - that the queue's filters and paging are asked of the SERVER. The table is
 *    server-paged, so a filter applied only in the browser reorders one page and
 *    reads as working.
 *  - that a refusal is shown in the server's own words, rather than swallowed
 *    the way the reference page swallows every failure.
 *  - that a control this user may not use is not offered as though it worked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { AdminAppRequests } from './AppRequests';
import { renderAdminRoute } from './__tests__/testRouter';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface AppRequestFixture {
  readonly id: number;
  readonly user_id: number;
  readonly user_email: string;
  readonly project_id: number;
  readonly issue_type: string;
  readonly entity_id: string;
  readonly description: string;
  readonly status: string;
  readonly rejection_comment: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

let recorded: RecordedRequest[] = [];

const REQUESTS: AppRequestFixture[] = [
  {
    id: 501,
    user_id: 4001,
    user_email: 'ada@example.com',
    project_id: 1,
    issue_type: 'Wikis',
    entity_id: 'wikis_Wikis',
    description: 'We need the wiki toolkit for onboarding docs.',
    status: 'pending',
    rejection_comment: null,
    created_at: '2026-08-01 09:00:00',
    updated_at: '2026-08-01 09:00:00',
  },
  {
    id: 502,
    user_id: 4001,
    user_email: 'ada@example.com',
    project_id: 1,
    issue_type: 'Inventory',
    entity_id: 'inventory',
    description: 'Asset tracking for the hardware lab.',
    status: 'approved',
    rejection_comment: null,
    created_at: '2026-08-02 09:00:00',
    updated_at: '2026-08-02 10:00:00',
  },
  {
    // Carries a reason on purpose: the reference page has no column for it, so
    // the operator's own words vanish the moment the reject dialog closes.
    id: 503,
    user_id: 4002,
    user_email: 'grace@example.com',
    project_id: 2,
    issue_type: 'Wikis',
    entity_id: 'wikis_Wikis',
    description: 'Second team wants the same toolkit.',
    status: 'rejected',
    rejection_comment: 'Not licensed for this tenant.',
    created_at: '2026-08-03 09:00:00',
    updated_at: '2026-08-03 11:00:00',
  },
];

let listBody: () => Response = () =>
  HttpResponse.json({ rows: REQUESTS, total: REQUESTS.length });
let decisionBody: () => Response = () => HttpResponse.json({ id: 501 });

function useAppRequestHandlers(): void {
  server.use(
    http.get('*/admin/moderation_statuses/administration', ({ request }) => {
      recorded.push({ method: 'GET', url: request.url, body: null });
      return listBody();
    }),
    http.put('*/admin/moderation_status/administration', async ({ request }) => {
      recorded.push({ method: 'PUT', url: request.url, body: await request.json() });
      return decisionBody();
    }),
  );
}

/** The permission list the Go adminui handler injects for a valid session. */
function grantAdminUiPermissions(permissions: string[]): void {
  window.admin_ui_config = { permissions, vite_server_url: '/api/v2' };
}

function writes(): RecordedRequest[] {
  return recorded.filter((entry) => entry.method === 'PUT');
}

function reads(): RecordedRequest[] {
  return recorded.filter((entry) => entry.method === 'GET');
}

function lastReadParams(): URLSearchParams {
  const all = reads();
  return new URL(all[all.length - 1]!.url).searchParams;
}

async function waitForQueue(): Promise<void> {
  await screen.findByText('We need the wiki toolkit for onboarding docs.');
}

beforeEach(() => {
  recorded = [];
  listBody = () => HttpResponse.json({ rows: REQUESTS, total: REQUESTS.length });
  decisionBody = () => HttpResponse.json({ id: 501 });
  configureGeneratedClient({ baseUrl: '/api/v2' });
  grantAdminUiPermissions(['admin.moderation', 'admin.moderation.edit']);
  useAppRequestHandlers();
});

afterEach(() => {
  resetGeneratedClient();
  delete window.admin_ui_config;
});

describe('AdminAppRequests — the queue', () => {
  it('renders the requester, the label and the catalogue key of each request', async () => {
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    // The requester is the whole point of the queue: an operator answers a
    // person, not a row id.
    // `getAllBy`: ada filed two of the three fixture rows, and a `getBy` here
    // would fail on the multiple match rather than on anything about the page.
    expect(screen.getAllByText('ada@example.com')).toHaveLength(2);
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();

    // "Application" is `issue_type` (the label the requesting client showed)
    // with `entity_id` beneath it. The reference renders `entity_id` alone,
    // capitalised with underscores stripped, which turns `wikis_Wikis` into
    // "Wikis Wikis" and elitea-web's synthetic key into a bare number.
    expect(screen.getAllByText('Wikis')).not.toHaveLength(0);
    expect(screen.getAllByText('wikis_Wikis')).not.toHaveLength(0);
    expect(screen.getByText('inventory')).toBeInTheDocument();
  });

  it('renders a rejection reason back on the row that carries it', async () => {
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    expect(screen.getByText(/Not licensed for this tenant\./)).toBeInTheDocument();
  });

  it('reads timestamps as UTC rather than as the viewer local time', async () => {
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    // The column is `TIMESTAMP` without a zone and the server sends it bare.
    // Rendering it as local time shifts every row by the viewer offset, which
    // looks plausible and is wrong.
    const expected = new Date('2026-08-01T09:00:00Z').toLocaleString();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('asks the SERVER for the pending queue on first load', async () => {
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    const params = lastReadParams();
    // Pending is the default because it is the only tab with anything to do.
    expect(params.get('status')).toBe('pending');
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
    expect(params.get('sort_by')).toBe('created_at');
    expect(params.get('sort_order')).toBe('desc');
  });

  it('sends the status filter to the server, and sends none at all for All', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('tab', { name: 'Rejected' }));
    await waitFor(() => expect(lastReadParams().get('status')).toBe('rejected'));

    // `all` is the ABSENCE of the filter, not a fourth value the server knows.
    // Sending `status=all` would filter the queue down to nothing.
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(lastReadParams().has('status')).toBe(false));
  });

  it('sends the search term to the server rather than filtering the page', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.type(screen.getByRole('textbox'), 'grace');
    await waitFor(() => expect(lastReadParams().get('search')).toBe('grace'));
  });

  it('shows the server own words when the queue read is refused', async () => {
    listBody = () =>
      HttpResponse.json({ error: 'failed to read app requests' }, { status: 500 });
    renderAdminRoute(<AdminAppRequests />);

    const alert = await screen.findByTestId('admin-app-requests-unavailable');
    // Not "Failed to load": the generic sentence would hide the only line that
    // says which of several refusals this was.
    expect(alert).toHaveTextContent('failed to read app requests');
  });
});

describe('AdminAppRequests — the decision', () => {
  it('approves by id, and sends nothing else', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('button', { name: 'Approve request: Wikis' }));
    await waitFor(() => expect(writes()).toHaveLength(1));

    const body = writes()[0]!.body as Record<string, unknown>;
    expect(body['id']).toBe(501);
    expect(body['status']).toBe('approved');
    // The server refuses a body carrying any of these with a 400, because the
    // moderator may not rewrite what was asked. Sending them would turn every
    // approval into a refusal.
    for (const forbidden of [
      'entity_id',
      'issue_type',
      'description',
      'user_id',
      'project_id',
      'meta',
      'rejection_comment',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('says the requester was notified, because that is what approving does', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('button', { name: 'Approve request: Wikis' }));
    const saved = await screen.findByTestId('admin-app-requests-saved');
    expect(saved).toHaveTextContent('notified');
  });

  it('refuses to send a rejection with no reason', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('button', { name: 'Reject request: Wikis' }));
    await user.click(screen.getByTestId('admin-app-requests-reject-confirm'));

    expect(await screen.findByText('A reason is required.')).toBeInTheDocument();
    // The server would answer 400. A dialog that sent it anyway would be making
    // a request it knows fails, and reporting the failure as if it were a
    // server problem.
    expect(writes()).toHaveLength(0);
  });

  it('sends the reason with the rejection', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('button', { name: 'Reject request: Wikis' }));
    // The dialog names the row being rejected. The reference dialog shows only
    // the words "Reject Request", so an operator working a queue confirms
    // without seeing which one.
    expect(screen.getByTestId('admin-app-requests-reject-subject')).toHaveTextContent(
      'ada@example.com',
    );

    await user.type(
      screen.getByTestId('admin-app-requests-reject-reason'),
      '  Not licensed for this tenant.  ',
    );
    await user.click(screen.getByTestId('admin-app-requests-reject-confirm'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0]!.body as Record<string, unknown>;
    expect(body).toEqual({
      id: 501,
      status: 'rejected',
      rejection_comment: 'Not licensed for this tenant.',
    });
  });

  it('shows the server own refusal instead of a generic failure', async () => {
    decisionBody = () =>
      HttpResponse.json(
        { error: 'rejection_comment is required when rejecting a request' },
        { status: 400 },
      );
    const user = userEvent.setup();
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    await user.click(screen.getByRole('button', { name: 'Approve request: Wikis' }));
    const alert = await screen.findByTestId('admin-app-requests-error');
    expect(alert).toHaveTextContent('rejection_comment is required');
  });

  it('offers no decision control on a request that is already decided', async () => {
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    const table = screen.getByRole('grid');
    const decided = within(table).getByText('Asset tracking for the hardware lab.').closest('[role="row"]');
    expect(decided).not.toBeNull();
    expect(within(decided as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('offers no decision control at all when the panel advertises no edit permission', async () => {
    // Presentation only — the server refuses regardless — but a button that
    // always fails is worse than no button.
    grantAdminUiPermissions(['admin.moderation']);
    renderAdminRoute(<AdminAppRequests />);
    await waitForQueue();

    expect(screen.queryByRole('button', { name: /Approve request/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject request/ })).toBeNull();
  });
});
