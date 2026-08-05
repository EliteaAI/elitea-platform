import type { ComponentProps } from 'react';

import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { ExportToolkitButton } from './ExportToolkitButton';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
  vi.restoreAllMocks();
});

function renderButton(props: Partial<ComponentProps<typeof ExportToolkitButton>> = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <ExportToolkitButton
        toolkitId="tk-1"
        name="My Toolkit"
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

describe('ExportToolkitButton', () => {
  it('fetches the real export endpoint and triggers a blob download on success', async () => {
    server.use(http.get('/api/v2/elitea_core/export_toolkit/prompt_lib/:projectId/:id', () => HttpResponse.json({ id: 'tk-1', type: 'github', settings: {} })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderButton();
    (await screen.findByRole('button', { name: 'export toolkit' })).click();

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
  });

  it('calls onError when the export request fails', async () => {
    server.use(http.get('/api/v2/elitea_core/export_toolkit/prompt_lib/:projectId/:id', () => HttpResponse.json({ error: 'nope' }, { status: 404 })));
    const onError = vi.fn();

    renderButton({ onError });
    (await screen.findByRole('button', { name: 'export toolkit' })).click();

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it('does nothing when the toolkit id is not yet known', async () => {
    const onError = vi.fn();
    renderButton({ toolkitId: undefined, onError });
    (await screen.findByRole('button', { name: 'export toolkit' })).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });

  it('disables the button while disabled is true', async () => {
    renderButton({ disabled: true });
    expect(await screen.findByRole('button', { name: 'export toolkit' })).toBeDisabled();
  });
});
