/**
 * The ONE decision this component owns: whether the assistant exists on this
 * page at all.
 *
 * Before the backend landed, `SupportAssistantWidget` was a no-op shell and
 * there was nothing to gate. Now it mounts a floating overlay on every page of
 * the app, so the failure to guard against is the opposite of the old one: an
 * assistant button appearing on a deployment that never enabled the feature, or
 * on one that enabled it and chose no agent — where the button opens a chat that
 * cannot answer.
 *
 * `enabled` is the SERVER's word for "the operator turned this on AND it can
 * actually serve", so these tests drive it from the endpoint rather than from a
 * client-side flag.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { SupportAssistantWidget } from './SupportAssistantWidget';

const BASE = '/api/v2';

/**
 * A real memory router and a real query client — NOTHING IS SUBSTITUTED but the
 * network (R-M1). That includes the vendored assistant itself: it mounts for
 * real when the config says it should, which is the only way these tests can
 * tell "the gate opened" from "the gate opened and the widget threw on mount".
 */
function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/agents'] }),
  });
  return <RouterProvider router={router as never} />;
}

function renderWidget(): { toggles: (() => void | undefined)[] } {
  const toggles: (() => void | undefined)[] = [];
  render(
    <SupportAssistantWidget>
      {({ onToggleAssistant }) => {
        toggles.push(onToggleAssistant as () => void);
        return null;
      }}
    </SupportAssistantWidget>,
    { wrapper },
  );
  return { toggles };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('SupportAssistantWidget', () => {
  it('mounts the assistant when the server reports it enabled', async () => {
    server.use(
      http.get(`${BASE}/support_assistant/config/`, () =>
        HttpResponse.json({ enabled: true, title: 'ELITEA Support', support_project_id: 7 }),
      ),
    );

    const { toggles } = renderWidget();

    expect(await screen.findByRole('button', { name: 'Support Assistant' })).toBeInTheDocument();
    await waitFor(() => {
      expect(toggles.at(-1)).toBeTypeOf('function');
    });
  });

  it('mounts NOTHING when the server reports it disabled', async () => {
    server.use(http.get(`${BASE}/support_assistant/config/`, () => HttpResponse.json({ enabled: false })));

    const { toggles } = renderWidget();

    await waitFor(() => {
      expect(toggles.length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Support Assistant' })).not.toBeInTheDocument();
    // NO TOGGLE EITHER. A caller offering an "ask support" affordance must be
    // able to tell there is nothing to open, rather than rendering a button that
    // calls into a ref holding null.
    expect(toggles.at(-1)).toBeUndefined();
  });

  it('mounts nothing when the config call FAILS', async () => {
    // A deployment mid-upgrade, or one whose route is not mounted. The failure
    // direction that matters is this one: an assistant that renders on a 500
    // would be a button that never works, on every page.
    server.use(
      http.get(`${BASE}/support_assistant/config/`, () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
    );

    const { toggles } = renderWidget();

    await waitFor(() => {
      expect(toggles.length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Support Assistant' })).not.toBeInTheDocument();
    expect(toggles.at(-1)).toBeUndefined();
  });

  it('renders its children regardless of whether the assistant is available', async () => {
    server.use(http.get(`${BASE}/support_assistant/config/`, () => HttpResponse.json({ enabled: false })));

    render(<SupportAssistantWidget>{() => <span>page content</span>}</SupportAssistantWidget>, { wrapper });

    expect(await screen.findByText('page content')).toBeInTheDocument();
  });
});
