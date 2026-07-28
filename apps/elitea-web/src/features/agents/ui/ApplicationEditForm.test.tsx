import type { ComponentProps } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { getListTagsMockHandler } from '@/shared/api/generated/tags/tags.msw';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../__tests__/testUtils';
import { ApplicationEditForm } from './ApplicationEditForm';

/** `EntityIcon`/`GradientIconWrapper` read `theme.shape`/`theme.vars.palette.*` — this file drives its own `RouterProvider` (needed for `useSelectedProjectId`'s `useRouteContext`) rather than the shared `renderWithProviders` helper, so the theme has to be wired in here too. */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(getListTagsMockHandler({ rows: [{ id: 1, name: 'billing', data: null }], total: 1 }));
});

afterEach(() => {
  resetGeneratedClient();
});

function renderForm(props: Partial<ComponentProps<typeof ApplicationEditForm>> = {}) {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <ApplicationEditForm
            name="My Agent"
            onNameChange={vi.fn()}
            description="Does things"
            onDescriptionChange={vi.fn()}
            tags={[]}
            onTagsChange={vi.fn()}
            projectId="proj-1"
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

describe('ApplicationEditForm', () => {
  it('renders the name and description fields seeded from props', async () => {
    renderForm();
    expect(await screen.findByTestId('agent-name-input')).toHaveValue('My Agent');
    expect(screen.getByTestId('agent-description-input')).toHaveValue('Does things');
  });

  it('trims the name on blur and reports it via onNameChange', async () => {
    const onNameChange = vi.fn();
    renderForm({ name: '', onNameChange });
    const input = await screen.findByTestId('agent-name-input');
    const user = userEvent.setup();
    await user.type(input, '  Trimmed Name  ');
    await user.tab();
    expect(onNameChange).toHaveBeenLastCalledWith('Trimmed Name');
  });

  it('reports every keystroke on the description field via onDescriptionChange', async () => {
    const onDescriptionChange = vi.fn();
    renderForm({ description: '', onDescriptionChange });
    const input = await screen.findByTestId('agent-description-input');
    await userEvent.setup().type(input, 'x');
    expect(onDescriptionChange).toHaveBeenCalledWith('x');
  });

  it('shows the "0 characters left" hint only while the name field is focused at the max length', async () => {
    renderForm({ name: 'x'.repeat(32) });
    const input = await screen.findByTestId('agent-name-input');
    expect(screen.queryByText(/characters left/)).not.toBeInTheDocument();
    await userEvent.setup().click(input);
    expect(screen.getByText('0 characters left')).toBeInTheDocument();
  });

  it('renders an existing tag passed via the tags prop', async () => {
    renderForm({ tags: [{ id: 1, name: 'billing', data: null }] });
    expect(await screen.findByText('billing')).toBeInTheDocument();
  });
});
