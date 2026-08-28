import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { AgentVersionControls } from './AgentVersionControls';

import type { ComponentProps, ReactNode } from 'react';

const versions = [
  { id: 1, name: 'base', created_at: '2026-01-01T12:00:00Z' },
  { id: 2, name: 'v1', created_at: '2026-02-01T12:00:00Z' },
] as const;

function withQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

function renderControls(overrides: Partial<ComponentProps<typeof AgentVersionControls>> = {}) {
  return renderWithTheme(
    withQueryClient(
      <AgentVersionControls
        applicationId="42"
        projectId="9"
        versions={versions}
        activeVersionId={1}
        onSelectVersion={vi.fn()}
        versionBody={{ instructions: 'do the thing' }}
        canSaveNewVersion
        onNewVersionSaved={vi.fn()}
        {...overrides}
      />,
    ),
  );
}

describe('AgentVersionControls', () => {
  it('renders the version selector trigger — the affordance issue 134 found missing from the agent edit page', () => {
    const { getByTestId } = renderControls();
    expect(getByTestId('version-selector-trigger')).toBeInTheDocument();
  });

  it('lists every version in the menu and reports the picked one to the caller', async () => {
    const onSelectVersion = vi.fn();
    const { getByTestId, getAllByRole, getByRole } = renderControls({ onSelectVersion });

    await userEvent.click(getByTestId('version-selector-trigger'));
    // Scoped to menu items: 'base' also labels the closed trigger, so an
    // unscoped text query cannot tell a populated menu from an empty one.
    // #147 added one COMMAND item ("Set as default") to the same menu; it is
    // excluded by test id so this stays an assertion about the version rows.
    const versionRows = getAllByRole('menuitem').filter((item) => item.dataset['testid'] !== 'agent-version-set-default');
    expect(versionRows.map((item) => item.textContent)).toEqual([
      expect.stringContaining('base'),
      expect.stringContaining('v1'),
    ]);
    await userEvent.click(getByRole('menuitem', { name: /^v1/ }));

    expect(onSelectVersion).toHaveBeenCalledTimes(1);
    expect(onSelectVersion.mock.calls[0]?.[0]).toMatchObject({ id: 2, name: 'v1' });
  });

  it('renders "Save As Version" when the viewer may write', () => {
    const { getByRole } = renderControls();
    expect(getByRole('button', { name: /save as version/i })).toBeInTheDocument();
  });

  it('hides "Save As Version" for a read-only viewer but keeps the selector', () => {
    const { queryByRole, getByTestId } = renderControls({ canSaveNewVersion: false });
    expect(queryByRole('button', { name: /save as version/i })).not.toBeInTheDocument();
    expect(getByTestId('version-selector-trigger')).toBeInTheDocument();
  });

  it('rejects a duplicate version name before sending anything, using the names it was given', async () => {
    const { getByRole, findByText } = renderControls();

    await userEvent.click(getByRole('button', { name: /save as version/i }));
    await userEvent.type(getByRole('textbox'), 'v1');
    await userEvent.click(getByRole('button', { name: /^save$/i }));

    expect(await findByText(/already exists/i)).toBeInTheDocument();
  });
});

const SET_DEFAULT_ROUTE = '*/elitea_core/default_version/prompt_lib/:projectId/:applicationId/:versionId';

/**
 * #147 — JRNY-015's middle step. The PATCH route, the Go handler, the repo
 * write and the generated `setApplicationDefaultVersion` all existed; the
 * menu that should reach them had version rows and nothing else. These tests
 * are about the COMPOSITION and the REQUEST, because "the hook works" was
 * already true and meant nothing — the same failure mode #134/#307 record.
 */
describe('AgentVersionControls — set default version', () => {
  beforeEach(() => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
  });

  afterEach(() => {
    resetGeneratedClient();
  });

  it('offers a set-default item inside the version menu the page actually mounts', async () => {
    const { getByTestId } = renderControls({ activeVersionId: 2 });

    await userEvent.click(getByTestId('version-selector-trigger'));

    const item = getByTestId('agent-version-set-default');
    expect(item).toBeInTheDocument();
    // Enabled, not merely present: a rendered-but-permanently-disabled item
    // would satisfy a presence-only assertion while reaching nothing.
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('PATCHes only after the confirm dialog is confirmed, then marks that version as the default', async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    server.use(
      http.patch(SET_DEFAULT_ROUTE, ({ request }) => {
        requests.push(new URL(request.url).pathname);
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );
    const { getByTestId, getByRole, queryByTestId } = renderControls({ activeVersionId: 2 });

    await user.click(getByTestId('version-selector-trigger'));
    await user.click(getByTestId('agent-version-set-default'));

    // Opening the dialog must not, by itself, change the default.
    expect(getByTestId('agent-version-set-default-name')).toHaveTextContent('v1');
    expect(requests).toHaveLength(0);

    await user.click(getByRole('button', { name: /set as a default/i }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toContain('/9/42/2');

    // The server reports no default back on any documented response (see the
    // component's disclosed gap), so the menu must show the one just set.
    await waitFor(() => expect(queryByTestId('agent-version-set-default-name')).not.toBeInTheDocument());
    await user.click(getByTestId('version-selector-trigger'));
    expect(getByTestId('agent-version-default-marker')).toBeInTheDocument();
    expect(getByTestId('agent-version-set-default')).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the dialog open and shows the refusal when the server rejects the version', async () => {
    const user = userEvent.setup();
    server.use(http.patch(SET_DEFAULT_ROUTE, () => HttpResponse.json({ error: 'version not found' }, { status: 404 })));
    const { getByTestId, getByRole, queryByTestId } = renderControls({ activeVersionId: 2 });

    await user.click(getByTestId('version-selector-trigger'));
    await user.click(getByTestId('agent-version-set-default'));
    await user.click(getByRole('button', { name: /set as a default/i }));

    await waitFor(() => expect(getByRole('alert')).toBeInTheDocument());
    expect(getByTestId('agent-version-set-default-name')).toBeInTheDocument();

    // …and nothing claims the default moved.
    await user.click(getByRole('button', { name: /^cancel$/i }));
    await user.click(getByTestId('version-selector-trigger'));
    expect(queryByTestId('agent-version-default-marker')).not.toBeInTheDocument();
  });

  it('offers no set-default item to a read-only viewer, and none before the project id resolves', async () => {
    const readOnly = renderControls({ activeVersionId: 2, canSaveNewVersion: false });
    await userEvent.click(readOnly.getByTestId('version-selector-trigger'));
    expect(readOnly.queryByTestId('agent-version-set-default')).not.toBeInTheDocument();
    readOnly.unmount();

    const noProject = renderControls({ activeVersionId: 2, projectId: undefined });
    await userEvent.click(noProject.getByTestId('version-selector-trigger'));
    expect(noProject.queryByTestId('agent-version-set-default')).not.toBeInTheDocument();
  });
});
