import type { ComponentProps } from 'react';

import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';
import { exportNetworkError, exportNotFound, exportOk } from '@/test/msw/handlers/download';

import { ExportApplicationButton } from './ExportApplicationButton';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: '1',
  };
  resetConfigForTests();
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  vi.restoreAllMocks();
});

function renderButton(props: Partial<ComponentProps<typeof ExportApplicationButton>> = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <ExportApplicationButton
        applicationId="app1"
        name="My Agent"
        {...props}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  return render(<RouterProvider router={router} />);
}

describe('ExportApplicationButton', () => {
  it('triggers a blob download on a successful export', async () => {
    setConfig();
    server.use(exportOk('My Agent.md'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderButton({ currentVersionId: 'v1' });
    (await screen.findByRole('button', { name: 'export agent' })).click();

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
  });

  it('calls onError on a 404', async () => {
    setConfig();
    server.use(exportNotFound());
    const onError = vi.fn();

    renderButton({ onError });
    (await screen.findByRole('button', { name: 'export agent' })).click();

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith({ kind: 'http', status: 404 });
  });

  it('calls onError on a network failure', async () => {
    setConfig();
    server.use(exportNetworkError());
    const onError = vi.fn();

    renderButton({ onError });
    (await screen.findByRole('button', { name: 'export agent' })).click();

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it('does nothing when the application id is not yet known', async () => {
    setConfig();
    const onError = vi.fn();
    renderButton({ applicationId: undefined, onError });
    (await screen.findByRole('button', { name: 'export agent' })).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });
});
