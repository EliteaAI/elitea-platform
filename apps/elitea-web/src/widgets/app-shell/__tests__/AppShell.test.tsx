import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getListProjectsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { getPermissionListMockHandler } from '@/shared/api/generated/auth/auth.msw';
import { getGetCurrentAuthorMockHandler } from '@/shared/api/generated/social/social.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { BRAND_PACK_GLOBAL, DEFAULT_BRAND_PACK } from '@/shared/brand';
import { installWebStorageShim } from '@/test/webstorage';
import { server } from '@/test/setup';

installWebStorageShim();

import { AppShell } from '../ui/AppShell';
import { useSelectedProjectStore } from '../model/selectedProject.store';
import { useSidebarCollapsedStore } from '@/widgets/sidebar';
import { renderWithNavigation } from './testHarness';

/** Default author fixture: a real `personal_project_id` distinct from every entry `getListProjectsMockHandler` returns below, so R1 tests can tell "personal project" apart from "first project in the list". */
function authorHandler(personalProjectId = '99') {
  return getGetCurrentAuthorMockHandler({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    avatar: '',
    description: '',
    personal_project_id: personalProjectId,
  });
}

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
  configureGeneratedClient({ baseUrl: 'https://elitea.example' });
  window.localStorage.clear();
  window.sessionStorage.clear();
  useSelectedProjectStore.setState({ project: null });
  useSidebarCollapsedStore.setState({ collapsed: false });
  server.use(
    getListProjectsMockHandler([
      { id: 11, name: 'Public', status: 'active', suspended: false },
      { id: 2, name: 'Acme', status: 'active', suspended: false },
    ]),
    getPermissionListMockHandler([{ name: 'models.chat.folders.get', enabled: true }]),
    authorHandler(),
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

  // R1 regression: the old app (`settings.js`'s `authorDetails.matchFulfilled`
  // extraReducer) defaults an unselected project to the CALLER'S OWN
  // personal/private project, never to the first entry of the public/shared
  // project list — even when that first entry (`id: 11`, 'Public') would
  // sort ahead of the personal one in `useProjectOptions`' ordering.
  it("auto-selects the caller's own personal project, not the first public-pinned project in the list", async () => {
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(useSelectedProjectStore.getState().project).toEqual({ id: '99', name: 'Private' });
    });
    expect(window.localStorage.getItem('el.project.id')).toBe('99');
    expect(window.localStorage.getItem('el.project.name')).toBe('Private');
  });

  it('does not auto-select any project until the personal-project signal (GET /social/author) resolves', async () => {
    server.use(authorHandler(''));
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(useSelectedProjectStore.getState().project).toBeNull();
  });

  it('sets document.title from the selected (personal) project once one is known', async () => {
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    await waitFor(() => {
      expect(document.title).toContain('Private');
    });
  });

  /**
   * The brand pack's `product.name` must reach `document.title` (JRNY-030's
   * "product name comes from the pack", issue #136 C). Before channel C was
   * wired the product name appeared in exactly one place — the static
   * `<title>Elitea</title>` in `index.html` — and the first route change
   * overwrote it, so nothing observable was ever pack-driven.
   *
   * Asserted against a SERVED pack with a distinct name, not the literal
   * "Elitea": the compiled default carries that same name, so a literal
   * assertion would pass with channel C entirely unwired.
   */
  it("appends the SERVED brand pack's product name to document.title", async () => {
    (window as unknown as Record<string, unknown>)[BRAND_PACK_GLOBAL] = {
      ...DEFAULT_BRAND_PACK,
      id: 'autotest-title',
      product: { name: 'Contoso Cloud', shortName: 'Contoso' },
    };

    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );

    // Both halves in ONE waitFor: the product name lands on the first paint
    // while the project is still resolving, so waiting on it alone would
    // resolve early and the project assertion below would race.
    await waitFor(() => {
      expect(document.title).toContain('Contoso Cloud');
      // The project half of the title is preserved, not replaced.
      expect(document.title).toContain('Private');
    });

    delete (window as unknown as Record<string, unknown>)[BRAND_PACK_GLOBAL];
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

  // R4 regression: old app (`MainSidebar.jsx` line 42 / `MainPanel.jsx` line
  // 19) hides the sidebar entirely and full-bleeds the main content on the
  // `/onboarding` route for a caller with no personal project yet.
  it('hides the sidebar on the onboarding route when the caller has no personal project yet', async () => {
    server.use(authorHandler(''));
    await renderWithNavigation(
      <AppShell>
        <div>onboarding content</div>
      </AppShell>,
      { initialPath: '/onboarding' },
    );
    expect(screen.getByText('onboarding content')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-create-button')).not.toBeInTheDocument();
  });

  it('still renders the sidebar on the onboarding route once the caller has a personal project', async () => {
    await renderWithNavigation(
      <AppShell>
        <div>onboarding content</div>
      </AppShell>,
      { initialPath: '/onboarding' },
    );
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-create-button')).toBeInTheDocument();
    });
  });

  it('renders the sidebar (unaffected) on a non-onboarding route regardless of the personal-project signal', async () => {
    server.use(authorHandler(''));
    await renderWithNavigation(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    );
    expect(screen.getByTestId('sidebar-create-button')).toBeInTheDocument();
  });
});
