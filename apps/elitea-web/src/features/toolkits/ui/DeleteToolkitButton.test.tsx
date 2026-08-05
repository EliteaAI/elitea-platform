import type { ComponentProps } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeleteApplicationToolMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../__tests__/testUtils';
import { DeleteToolkitButton } from './DeleteToolkitButton';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function renderButton(props: Partial<ComponentProps<typeof DeleteToolkitButton>> = {}) {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <DeleteToolkitButton
            toolkitId="42"
            name="My Toolkit"
            {...props}
          />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  return render(<RouterProvider router={router} />);
}

describe('DeleteToolkitButton', () => {
  it('opens the confirmation modal on click, closed by default', async () => {
    const user = userEvent.setup();
    renderButton();
    expect(screen.queryByText('Delete confirmation')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'delete entity' }));
    expect(screen.getByText('Delete confirmation')).toBeInTheDocument();
  });

  it('requires typing the exact name before Delete is enabled, then calls onDeleted', async () => {
    server.use(getDeleteApplicationToolMockHandler());
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderButton({ onDeleted });

    await user.click(await screen.findByRole('button', { name: 'delete entity' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'My Toolkit');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('calls onError when the delete request fails', async () => {
    server.use(http.delete('*/elitea_core/tool/prompt_lib/:projectId/:toolId', () => HttpResponse.json({ error: 'nope' }, { status: 403 })));
    const onError = vi.fn();
    const user = userEvent.setup();
    renderButton({ onError });

    await user.click(await screen.findByRole('button', { name: 'delete entity' }));
    await user.type(screen.getByLabelText('Name'), 'My Toolkit');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it('disables the trigger button while disabled is true', async () => {
    renderButton({ disabled: true });
    expect(await screen.findByRole('button', { name: 'delete entity' })).toBeDisabled();
  });
});
