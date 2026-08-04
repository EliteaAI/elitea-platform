import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConfigResult } from '@/shared/config';

import {
  isPublicProjectId,
  selectPermissions,
  selectProjectId,
  useCurrentUserPermissions,
  useSelectedProjectId,
} from './useRouterAuth';

describe('selectProjectId (pure)', () => {
  it('reads auth.getSelectedProjectId() when present', () => {
    expect(selectProjectId({ auth: { getSelectedProjectId: () => 'proj-1' } })).toBe('proj-1');
  });

  it('returns undefined for a not-yet-wired context', () => {
    expect(selectProjectId({})).toBeUndefined();
    expect(selectProjectId(undefined)).toBeUndefined();
    expect(selectProjectId(null)).toBeUndefined();
    expect(selectProjectId('nope')).toBeUndefined();
  });
});

describe('selectPermissions (pure)', () => {
  it('reads auth.getUser().permissions when present', () => {
    expect(selectPermissions({ auth: { getUser: () => ({ permissions: ['a', 'b'] }) } })).toEqual(['a', 'b']);
  });

  it('defaults to an empty array when the user or permissions are absent', () => {
    expect(selectPermissions({ auth: { getUser: () => undefined } })).toEqual([]);
    expect(selectPermissions({ auth: {} })).toEqual([]);
    expect(selectPermissions({})).toEqual([]);
    expect(selectPermissions(undefined)).toEqual([]);
  });
});

describe('isPublicProjectId (pure)', () => {
  const ok: ConfigResult = {
    status: 'ok',
    config: {
      vite_server_url: '/api/v2',
      vite_base_uri: '/',
      vite_public_project_id: 'pub-1',
      allow_project_own_llms: true,
    },
  };
  const missing: ConfigResult = { status: 'missing', missing: ['vite_public_project_id'], reasons: {} };

  it('is true when projectId matches the configured public project id', () => {
    expect(isPublicProjectId('pub-1', ok)).toBe(true);
  });

  it('is false when projectId is a different project', () => {
    expect(isPublicProjectId('other-project', ok)).toBe(false);
  });

  it('is true when projectId is undefined (adversarial-review fix, cluster A12-api-model finding 1): an anonymous/no-selected-project visitor must default to the disclosed-safe public-catalog placeholder, not the misleading "author has created nothing" empty state', () => {
    expect(isPublicProjectId(undefined, ok)).toBe(true);
    expect(isPublicProjectId(undefined, missing)).toBe(true);
  });

  it('is false when the config is missing but a concrete projectId was supplied', () => {
    expect(isPublicProjectId('pub-1', missing)).toBe(false);
  });
});

function ProbeComponent() {
  const projectId = useSelectedProjectId();
  const permissions = useCurrentUserPermissions();
  return (
    <output>
      {projectId ?? 'none'}|{permissions.join(',')}
    </output>
  );
}

function renderWithRouterContext(auth: {
  getSelectedProjectId: () => string | undefined;
  getUser: () => { permissions?: readonly string[] } | undefined;
}) {
  const rootRoute = createRootRoute({ component: ProbeComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth },
  });
  return render(<RouterProvider router={router} />);
}

describe('useSelectedProjectId / useCurrentUserPermissions (wiring)', () => {
  it('resolves the id and permissions supplied through the real router root context', async () => {
    renderWithRouterContext({
      getSelectedProjectId: () => 'proj-42',
      getUser: () => ({ permissions: ['models.applications.applications.list'] }),
    });
    expect(await screen.findByText('proj-42|models.applications.applications.list')).toBeInTheDocument();
  });

  it('resolves to "none" / empty against the stub-shaped context', async () => {
    renderWithRouterContext({ getSelectedProjectId: () => undefined, getUser: () => undefined });
    expect(await screen.findByText('none|')).toBeInTheDocument();
  });
});
