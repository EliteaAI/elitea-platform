/**
 * Regression tests for the Wave-2 unit A13 adversarial-review fixes to
 * `Onboarding.tsx` (cluster A13-onboarding-modeswitch) — the first test
 * coverage `pages/onboarding/` has ever had. Covers:
 *  - blocker: `theme.vars.palette.*` usage + the `onboardingBody` ternary
 *    inversion (findings 1 + 2)
 *  - warning: the back button hidden for a first-run user (finding 5)
 *  - warning: Welcome/tour render-guard exclusivity, and the loading branch
 *    staying absent for a fully-loaded mock user (finding 6 — see the note
 *    on that `it` below for what this CANNOT prove)
 *  - warning: progress/polling resumes after a refresh mid-onboarding
 *    (finding 3)
 *  - warning: the mock poll actually resolves, so "workspace is ready" is
 *    reachable (finding 4)
 *
 * Plus one later regression: "Jump in" left the SPA entirely — see the
 * `describe('Onboarding jump in')` block's own comment.
 */
import { ThemeProvider } from '@mui/material/styles';
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { createStorage } from '@/shared/lib/storage';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

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

afterEach(() => {
  // Unconditional, regardless of which test's own fake-timers usage was
  // reached — matches `McpAuthCallbackPage.test.tsx`'s convention.
  vi.useRealTimers();
  sessionStore.remove('onboarding_state');
});

describe('Onboarding', () => {
  it('reads every themed colour via theme.vars.palette.* — live CSS variables, not resolved/dropped values (blocker findings 1 + 2)', () => {
    renderWithTheme(<Onboarding />);
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

  it('hides the back button for a first-run user with no personal project yet (warning finding 5)', () => {
    renderWithTheme(<Onboarding />);
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  /**
   * Finding 6 restored `!user.personal_project_id && user.id` on the Welcome
   * guard and the `!user.id` loading branch, mirroring the old app. With
   * today's static `MOCK_USER` (`id` always set, `personal_project_id`
   * always blank — change 1's disclosed mock), those two extra conditions
   * are permanently true/false and cannot be toggled from a test, so this
   * can only exercise the part that IS observable: Welcome and the tour are
   * mutually exclusive across the `showTour` toggle, and the loading branch
   * never shows for this always-loaded mock user. It cannot, by itself,
   * distinguish the restored guard from the old bare `!showTour` one — see
   * this cluster's final report for the follow-up once real user data lands.
   */
  it('shows only the Welcome screen before the tour starts, and only the tour after — the loading branch never shows for the mock user (warning finding 6)', () => {
    renderWithTheme(<Onboarding />);

    expect(screen.getByText('Welcome to Elitea!')).toBeInTheDocument();
    expect(screen.queryByLabelText('View tour in full screen')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: /loading/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));

    expect(screen.queryByText('Welcome to Elitea!')).not.toBeInTheDocument();
    expect(screen.getByLabelText('View tour in full screen')).toBeInTheDocument();
  });

  it('resumes the progress bar after a refresh mid-onboarding, without any click in this mount (warning finding 3)', async () => {
    // Simulates a browser refresh mid-onboarding: the flag `handleShowTour`
    // sets is already there, but nothing in THIS mount ever called it.
    sessionStore.set('onboarding_state', 'true');
    vi.useFakeTimers();

    renderWithTheme(<Onboarding />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '5');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(5);
  });

  it('reaches "workspace is ready" through the live Get-started-and-wait flow — the poll stub no longer no-ops forever (warning finding 4)', async () => {
    renderWithTheme(<Onboarding />);
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));

    // Stepped, not one big jump (verified empirically — a single 200s
    // `advanceTimersByTimeAsync` call across this many compounding 1s/5s
    // intervals leaves React's state update mid-flight in this test
    // environment; 20 real steps of 10s each does not).
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    expect(screen.getByRole('button', { name: /Jump in now!/i })).toBeInTheDocument();
  });
});

/**
 * DEFECT: "Jump in" ended a brand-new account's very first action on a 404.
 *
 * `handleJumpIn` assigned `window.location.href = '/chat'` — a root-relative
 * full-page navigation. The router runs under `basepath: getAppBasename()`
 * (`/app/` in every real deployment), and nginx serves only `/app/...`. The
 * browser therefore left the SPA, and `GET /chat` reached the API. The API
 * answers a bare `404 page not found`. The module header claimed no route
 * mounted this page, which was stale. `src/routes/_shell/onboarding.tsx`
 * mounts it. The index guard redirects a user with no `personal_project_id`
 * straight to it.
 *
 * This case walks the real flow to the "Jump in now!" button and asserts the
 * router moved, so a raw `window.location` assignment fails here.
 */
describe('Onboarding jump in', () => {
  const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

  function renderInRouter() {
    const rootRoute = createRootRoute({
      component: () => (
        <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
          <Outlet />
        </ThemeProvider>
      ),
    });
    const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/onboarding', component: Onboarding });
    const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: () => <div>chat</div> });
    const router = createRouter({
      routeTree: rootRoute.addChildren([onboardingRoute, chatRoute]),
      history: createMemoryHistory({ initialEntries: ['/app/onboarding'] }),
      basepath: '/app',
    });
    render(<RouterProvider router={router as never} />);
    return router;
  }

  it('navigates through the router, so the app basename is kept', async () => {
    const router = renderInRouter();
    await act(async () => {
      await Promise.resolve();
    });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: /Sure, let.s go!/i }));
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    fireEvent.click(screen.getByRole('button', { name: /Jump in now!/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(router.state.location.pathname).toBe('/chat');
    // The basename the raw `window.location.href = '/chat'` dropped.
    expect(router.history.location.pathname).toBe('/app/chat');
  });
});
