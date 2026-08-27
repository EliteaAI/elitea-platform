/**
 * Onboarding page tests.
 *
 * THE ONE THAT MATTERS is `waits for the SERVER`. This page's whole job is to
 * wait until `GET /social/author` names a `personal_project_id` and then let
 * the user in. It used to wait on a TIMER instead — a stub poll that declared
 * the workspace ready once the cosmetic progress bar hit its cap, roughly 150
 * seconds, whatever the server said. A user whose personal project did not
 * exist (every account on a fresh deployment, before
 * internal/application/personalproject) was told it did, sent to `/chat` with
 * no project, and bounced back here by the index guard: the "stuck in
 * onboarding" loop. That test drives 200 seconds with the server still
 * answering `""` and asserts the page has NOT let the user through, which is
 * exactly what the old implementation could not satisfy.
 *
 * The rest keep the Wave-2 unit A13 adversarial-review fixes honest:
 *  - `theme.vars.palette.*` usage + the `onboardingBody` ternary (findings 1+2)
 *  - the back button's visibility rule (finding 5)
 *  - Welcome/tour exclusivity and the loading branch (finding 6)
 *  - progress resuming after a refresh mid-onboarding (finding 3)
 *  - "Jump in" navigating through the router, basename kept
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { getGetCurrentAuthorMockHandler } from '@/shared/api/generated/social/social.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { createStorage } from '@/shared/lib/storage';

import Onboarding from './Onboarding';

/**
 * Every `<style>` element's text, concatenated — the real, rendered CSS
 * output. Same pattern as `src/app/providers/BrandThemeProvider.test.tsx` /
 * `src/features/pipelines/ui/YamlCodeEditor.test.tsx`: jsdom's
 * `getComputedStyle` does not reliably evaluate `sx`-driven shorthand
 * properties like `background` back out, so asserting on the emitted
 * stylesheet text is the real, reliable way to prove what an `sx` callback
 * actually produced.
 */
function renderedStyleText(): string {
  return [...document.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n');
}

const sessionStore = createStorage('session');
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * What `GET /social/author` currently answers. A mutable fixture rather than a
 * re-registered handler, because the point of most cases here is that the
 * SAME poll sees the answer CHANGE — which is what happens in production when
 * elitea-main finishes provisioning the personal project.
 */
let personalProjectId = '';

/** `auth.refreshSession` calls the page made through the router context. */
let refreshCalls = 0;

beforeEach(() => {
  personalProjectId = '';
  refreshCalls = 0;
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  configureGeneratedClient({ baseUrl: 'https://elitea.example' });
  server.use(
    getGetCurrentAuthorMockHandler(() => ({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      avatar: '',
      description: '',
      personal_project_id: personalProjectId,
    })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetConfigForTests();
  resetGeneratedClient();
  sessionStore.remove('onboarding_state');
});

/**
 * Router + QueryClient + theme, mounting the page at `/app/onboarding` with a
 * `/chat` sibling to navigate to — the real pair the page moves between.
 *
 * `basepath: '/app'` is not decoration: it is what a raw
 * `window.location.href = '/chat'` used to drop, sending a brand-new account
 * out of the SPA and into a 404 on its very first action.
 *
 * The router context carries an `auth.refreshSession` double, which is how the
 * page tells the guards that the session they captured at boot is stale — see
 * `src/app/router-context.ts`.
 */
async function renderOnboarding(options?: { readonly initialEntries?: readonly string[] }) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <Outlet />
      </ThemeProvider>
    ),
  });
  const onboardingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/onboarding',
    component: Onboarding,
  });
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => <div>chat</div>,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([onboardingRoute, chatRoute]),
    history: createMemoryHistory({
      initialEntries: [...(options?.initialEntries ?? ['/app/onboarding'])],
    }),
    basepath: '/app',
    context: {
      auth: {
        refreshSession: () => {
          refreshCalls += 1;
          return Promise.resolve();
        },
      },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return router;
}

/** Drives `ms` of fake time in 1 s slices, flushing React between each. */
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe('Onboarding', () => {
  it('reads every themed colour via theme.vars.palette.* — live CSS variables, not resolved/dropped values (blocker findings 1 + 2)', async () => {
    await renderOnboarding();
    const css = renderedStyleText();

    // Finding 2: theme.vars.palette.*, not theme.palette.* (which would bake
    // a raw value in here instead of a scheme-reactive CSS variable).
    expect(css).toContain('var(--el-palette-background-default)');
    expect(css).toContain('var(--el-palette-background-onboarding)');
    expect(css).toContain('var(--el-palette-boxShadow-onboarding)');
    // Finding 1: the content-panel background ternary was inverted and
    // always dropped `onboardingBody` in favour of the fallback — fixed, the
    // real token must actually reach the stylesheet.
    expect(css).toContain('var(--el-palette-background-onboardingBody)');
  });

  it('hides the back button for a first-run user with no personal project yet (warning finding 5)', async () => {
    await renderOnboarding();
    await screen.findByText('Welcome to Elitea!');
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  it('shows the back button for a user who already has a personal project and somewhere to go back to', async () => {
    personalProjectId = '42';
    await renderOnboarding({ initialEntries: ['/app/chat', '/app/onboarding'] });

    expect(await screen.findByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });

  it('shows only the Welcome screen before the tour starts, and only the tour after; the loading branch covers the pending author query (warning finding 6)', async () => {
    await renderOnboarding();

    expect(await screen.findByText('Welcome to Elitea!')).toBeInTheDocument();
    expect(screen.queryByLabelText('View tour in full screen')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /loading/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));

    expect(screen.queryByText('Welcome to Elitea!')).not.toBeInTheDocument();
    expect(screen.getByLabelText('View tour in full screen')).toBeInTheDocument();
  });

  it('shows the loading spinner while the author query has not answered', async () => {
    // No handler answer yet: the request hangs, so the page has no user.
    server.use(getGetCurrentAuthorMockHandler(() => new Promise(() => {}) as never));
    await renderOnboarding();

    expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText('Welcome to Elitea!')).not.toBeInTheDocument();
  });

  /**
   * THE REGRESSION TEST FOR THE BUG.
   *
   * 200 seconds of waiting, with the server still answering
   * `personal_project_id: ""` — well past the 150 s at which the old stub poll
   * declared victory. The page must still be waiting. Then the server names a
   * project, and one poll interval later the user is let in.
   */
  it('waits for the SERVER to name a personal project, not for the progress bar to fill', async () => {
    await renderOnboarding();
    await screen.findByText('Welcome to Elitea!');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));
    await advance(200_000);

    expect(screen.queryByRole('button', { name: /Jump in now!/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Configuring Personal project/i)).toBeInTheDocument();

    // elitea-main finished provisioning; the next poll sees it.
    personalProjectId = '42';
    await advance(10_000);

    expect(screen.getByRole('button', { name: /Jump in now!/i })).toBeInTheDocument();
    expect(screen.queryByText(/Configuring Personal project/i)).not.toBeInTheDocument();
  });

  /**
   * The guards read the router's session, not this page's query. A session
   * still carrying no personal project sends the user straight back here on
   * the next visit to `/`, which is the same loop from the other side.
   */
  it('refreshes the router session once the personal project arrives', async () => {
    await renderOnboarding();
    await screen.findByText('Welcome to Elitea!');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));
    expect(refreshCalls).toBe(0);

    personalProjectId = '42';
    await advance(10_000);

    expect(refreshCalls).toBeGreaterThan(0);
  });

  it('lets a user who already holds a personal project straight through, with no wait at all', async () => {
    personalProjectId = '42';
    await renderOnboarding();

    expect(await screen.findByRole('button', { name: /Jump in now!/i })).toBeInTheDocument();
    expect(screen.queryByText(/Configuring Personal project/i)).not.toBeInTheDocument();
  });

  it('resumes the progress bar after a refresh mid-onboarding, without any click in this mount (warning finding 3)', async () => {
    // Simulates a browser refresh mid-onboarding: the flag `handleShowTour`
    // sets is already there, but nothing in THIS mount ever called it.
    sessionStore.set('onboarding_state', 'true');
    // Fake timers BEFORE the render: the interval this test is about is
    // created by a mount effect, and one created under real timers would not
    // be driven by `advance` at all — the assertion would then measure the
    // test harness rather than the page.
    vi.useFakeTimers();
    await renderOnboarding();
    // One second of it settles the author query (whose own spinner is also a
    // `progressbar`), so the query below can only match the determinate bar.
    await advance(1000);

    const bar = screen.getByRole('progressbar');
    const resumed = Number(bar.getAttribute('aria-valuenow'));

    await advance(3000);

    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(resumed);
  });
});

/**
 * DEFECT: "Jump in" ended a brand-new account's very first action on a 404.
 *
 * `handleJumpIn` assigned `window.location.href = '/chat'` — a root-relative
 * full-page navigation. The router runs under `basepath: getAppBasename()`
 * (`/app/` in every real deployment), and nginx serves only `/app/...`. The
 * browser therefore left the SPA, and `GET /chat` reached the API, which
 * answers a bare `404 page not found`.
 */
describe('Onboarding jump in', () => {
  it('navigates through the router, so the app basename is kept', async () => {
    personalProjectId = '42';
    const router = await renderOnboarding();

    fireEvent.click(await screen.findByRole('button', { name: /Jump in now!/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat');
    });
    // The basename the raw `window.location.href = '/chat'` dropped.
    expect(router.history.location.pathname).toBe('/app/chat');
  });
});
