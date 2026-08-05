import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getListProjectsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { getPermissionListMockHandler } from '@/shared/api/generated/auth/auth.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { installWebStorageShim } from '@/test/webstorage';
import { server } from '@/test/setup';

installWebStorageShim();

import { AppShell } from '../ui/AppShell';
import { useSelectedProjectStore } from '../model/selectedProject.store';
import { useSidebarCollapsedStore } from '@/widgets/sidebar';
import { renderWithNavigation } from './testHarness';

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
  configureGeneratedClient({ baseUrl: 'https://elitea.example' });
  window.localStorage.clear();
  useSelectedProjectStore.setState({ project: null });
  useSidebarCollapsedStore.setState({ collapsed: false });
  server.use(
    getListProjectsMockHandler([
      { id: 11, name: 'Public', status: 'active', suspended: false },
      { id: 2, name: 'Acme', status: 'active', suspended: false },
    ]),
    getPermissionListMockHandler([{ name: 'models.chat.folders.get', enabled: true }]),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
  resetGeneratedClient();
});

describe('AppShell', () => {
  it('renders the sidebar and the page content together', async () => {
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-create-button')).toBeInTheDocument();
  });

  it('auto-selects the first (public-pinned) project once the project list loads', async () => {
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(useSelectedProjectStore.getState().project).toEqual({ id: '11', name: 'Public' });
    });
    expect(window.localStorage.getItem('el.project.id')).toBe('11');
  });

  it('sets document.title from the selected project once one is known', async () => {
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(document.title).toContain('Public');
    });
  });

  it('prefers a previously-persisted project selection over the auto-picked default', async () => {
    window.localStorage.setItem('el.project.id', '2');
    window.localStorage.setItem('el.project.name', 'Acme');
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(useSelectedProjectStore.getState().project).toEqual({ id: '2', name: 'Acme' });
    });
  });
});
