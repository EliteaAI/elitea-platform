import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

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
    expect(getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
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
