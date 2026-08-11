/**
 * Rendering + query guard for `pages/admin/ProjectActivityDrawer.tsx` (unit A14).
 *
 * The three properties worth asserting here are all ones a "does it render?"
 * test passes straight through:
 *
 *  1. Every query is SCOPED to the project the drawer was opened for. This
 *     drawer reuses the deployment-wide audit endpoints; a missing `project_id`
 *     would show another tenant's traces under this project's name, and the
 *     rows would look perfectly plausible.
 *  2. The per-member squares reflect the `project_user_activity` response.
 *     That endpoint was an empty-array stub with no route before this unit, so
 *     "the squares render" is exactly what the broken version also did — the
 *     assertion has to be on the counts.
 *  3. Opening the drawer for a SECOND project does not inherit the first's
 *     state. The reference resets some fields on close and leaks the rest.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { ProjectActivityDrawer } from './ProjectActivityDrawer';
import type { AdminProjectRow } from './api/adminProjectsApi';
import { renderAdminRoute } from './__tests__/testRouter';

function project(id: number, name: string): AdminProjectRow {
  return {
    id,
    name,
    owner_id: 1,
    owner_name: 'Ada Owner',
    admin_names: [],
    status: 'active',
    suspended: false,
    create_success: true,
    is_personal: false,
  };
}

const TRACES = {
  rows: [
    {
      trace_id: 'trace-aaaa-bbbb',
      start_time: '2026-08-01T10:00:00',
      duration_ms: 1250,
      span_count: 4,
      error_count: 0,
      has_error: false,
      user_email: 'ada@example.com',
      project_id: 41,
      event_types: ['api'],
      root_action: 'list_prompts',
      root_event_type: 'api',
      root_http_method: 'GET',
      root_status_code: 200,
    },
  ],
  total: 1,
};

const MEMBERS = {
  rows: [
    { id: '77', email: 'busy@example.com', name: 'Busy Person', roles: ['admin'] },
    { id: '78', email: 'idle@example.com', name: 'Idle Person', roles: ['viewer'] },
  ],
  total: 2,
};

const ACTIVITY = {
  rows: [{ user_id: 77, user_email: 'busy@example.com', event_count: 42 }],
};

let requestedUrls: string[] = [];

function useDrawerHandlers(): void {
  server.use(
    http.get('*/elitea_core/audit_traces/administration', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json(TRACES);
    }),
    http.get('*/elitea_core/audit/administration', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json({ rows: [], total: 0 });
    }),
    http.get('*/elitea_core/audit_trace_heatmap/administration', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json({ data: [], metadata: null });
    }),
    http.get('*/elitea_core/audit_heatmap/administration', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json({ data: [], metadata: null });
    }),
    http.get('*/elitea_core/project_user_activity/administration', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json(ACTIVITY);
    }),
    http.get('*/admin/users/administration/*', ({ request }) => {
      requestedUrls.push(request.url);
      return HttpResponse.json(MEMBERS);
    }),
  );
}

function auditUrls(): string[] {
  return requestedUrls.filter((url) => url.includes('/elitea_core/'));
}

beforeEach(() => {
  requestedUrls = [];
  configureGeneratedClient({ baseUrl: '/api/v2' });
  window.admin_ui_config = { permissions: [], vite_server_url: '/api/v2' };
  useDrawerHandlers();
});

afterEach(() => {
  resetGeneratedClient();
  delete window.admin_ui_config;
});

describe('Admin › Projects › activity drawer', () => {
  it('names the project it was opened for', async () => {
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);

    expect(await screen.findByText('atlas (ID: 41)')).toBeInTheDocument();
  });

  it('scopes EVERY audit query to that project', async () => {
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);
    await screen.findByText('atlas (ID: 41)');

    // Both the listing and the heatmap must carry it: a heatmap filtered
    // differently from the table below it is a lie about the same data.
    await waitFor(() => expect(auditUrls().length).toBeGreaterThanOrEqual(3));
    for (const url of auditUrls()) {
      expect(url).toContain('project_id=41');
    }
  });

  it('renders trace rows from the shared audit endpoint', async () => {
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
  });

  it('shades the per-member squares from the activity counts', async () => {
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);

    const strip = await screen.findByTestId('project-user-activity');
    // One square per MEMBER, labelled with that member's count — so the strip
    // distinguishes the busy member from the idle one. The stub this endpoint
    // used to be returned an empty array, which renders both as 0.
    expect(within(strip).getByLabelText('Busy Person: 42')).toBeInTheDocument();
    expect(within(strip).getByLabelText('Idle Person: 0')).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2 active/)).toBeInTheDocument();
  });

  it('switches to spans and re-queries the span endpoint, still scoped', async () => {
    const user = userEvent.setup();
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);
    await screen.findByText('atlas (ID: 41)');

    await user.click(screen.getByRole('tab', { name: 'Spans' }));

    await waitFor(() =>
      expect(
        auditUrls().some(
          (url) => url.includes('/elitea_core/audit/administration') && url.includes('project_id=41'),
        ),
      ).toBe(true),
    );
  });

  it('does not query at all while it is closed', async () => {
    renderAdminRoute(<ProjectActivityDrawer project={null} onClose={() => {}} />);

    // A drawer that queries for `project_id=0` on every page render is the
    // reference's `skip: !open || !projectId` guard, restated.
    await waitFor(() => expect(auditUrls()).toHaveLength(0));
    expect(screen.queryByRole('tab', { name: 'Traces' })).not.toBeInTheDocument();
  });

  it('rebuilds its state for a second project rather than inheriting the first', async () => {
    // Switched from INSIDE the tree: `rerender` would replace the providers
    // `renderAdminRoute` mounted, which is not what the page does — it swaps
    // the `project` prop while everything above stays put.
    function SwitchableDrawer() {
      const [current, setCurrent] = useState(project(41, 'atlas'));
      return (
        <>
          <button type="button" onClick={() => setCurrent(project(42, 'borealis'))}>
            switch
          </button>
          <ProjectActivityDrawer project={current} onClose={() => {}} />
        </>
      );
    }

    const user = userEvent.setup();
    renderAdminRoute(<SwitchableDrawer />);
    await screen.findByText('atlas (ID: 41)');

    // Leave the first project on the Spans view.
    await user.click(screen.getByRole('tab', { name: 'Spans' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Spans' })).toHaveAttribute('aria-selected', 'true'),
    );

    // `hidden: true`: MUI's modal Drawer marks its siblings `aria-hidden`, so
    // the switch control is outside the accessibility tree while it is open.
    await user.click(screen.getByRole('button', { name: 'switch', hidden: true }));

    expect(await screen.findByText('borealis (ID: 42)')).toBeInTheDocument();
    // The reference leaks the view mode, page size and sort between projects.
    expect(screen.getByRole('tab', { name: 'Traces' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reports a failed listing instead of rendering it as a quiet project', async () => {
    server.use(
      http.get('*/elitea_core/audit_traces/administration', () =>
        HttpResponse.json({ error: 'failed to query audit traces' }, { status: 500 }),
      ),
    );
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);

    expect(
      await screen.findByText('Failed to load this project’s activity.'),
    ).toBeInTheDocument();
  });

  it('reports a failed per-user activity read rather than greying every square', async () => {
    server.use(
      http.get('*/elitea_core/project_user_activity/administration', () =>
        HttpResponse.json({ error: 'failed to query project user activity' }, { status: 500 }),
      ),
    );
    renderAdminRoute(<ProjectActivityDrawer project={project(41, 'atlas')} onClose={() => {}} />);

    // The reference has no error branch here at all, so a 500 renders as
    // "No users found" — a fact about the project rather than about the request.
    expect(await screen.findByText('Failed to load per-user activity.')).toBeInTheDocument();
  });
});
