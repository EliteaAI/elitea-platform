import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { selectProjectId, useSelectedProjectId } from './useSelectedProjectId';

describe('selectProjectId (pure)', () => {
  it('reads auth.getSelectedProjectId() when present', () => {
    const context = { auth: { getSelectedProjectId: () => 'proj-1' } };
    expect(selectProjectId(context)).toBe('proj-1');
  });

  it('returns undefined when the accessor itself returns undefined (no project selected yet)', () => {
    const context = { auth: { getSelectedProjectId: () => undefined } };
    expect(selectProjectId(context)).toBeUndefined();
  });

  it('returns undefined when context has no auth field (not-yet-wired root context)', () => {
    expect(selectProjectId({})).toBeUndefined();
  });

  it('returns undefined when auth has no getSelectedProjectId method', () => {
    expect(selectProjectId({ auth: {} })).toBeUndefined();
  });

  it('returns undefined for non-object input (defensive)', () => {
    expect(selectProjectId(undefined)).toBeUndefined();
    expect(selectProjectId(null)).toBeUndefined();
    expect(selectProjectId('nope')).toBeUndefined();
  });
});

function ProbeComponent() {
  const projectId = useSelectedProjectId();
  return <output>{projectId ?? 'none'}</output>;
}

function renderWithRouterContext(auth: { getSelectedProjectId: () => string | undefined }) {
  const rootRoute = createRootRoute({ component: ProbeComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth },
  });
  return render(<RouterProvider router={router} />);
}

describe('useSelectedProjectId (wiring)', () => {
  it('resolves the id supplied through the real TanStack Router root context', async () => {
    renderWithRouterContext({ getSelectedProjectId: () => 'proj-42' });
    expect(await screen.findByText('proj-42')).toBeInTheDocument();
  });

  it('resolves to "none" (undefined) against the stub-shaped context, same as an un-overridden router', async () => {
    renderWithRouterContext({ getSelectedProjectId: () => undefined });
    expect(await screen.findByText('none')).toBeInTheDocument();
  });
});
