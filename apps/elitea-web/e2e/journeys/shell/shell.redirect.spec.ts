/**
 * Journey 1: Cold load / → redirect chain → /chat (JRNY-001)
 * Journey 2: Login via OIDC → target_to honoured (JRNY-002)
 * Journey 4: Logout → all el.* storage cleared (JRNY-004)
 *
 * Spec §8.5 acceptance (from parity/manifest/shell.json JRNY-001/002/004).
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';

// ─────────────────────────────────────────────────────────────────────────────
// Journey 1: Cold load / → /chat
// ─────────────────────────────────────────────────────────────────────────────
test('J1: cold load / redirects through to /chat', async ({ page }) => {
  // Navigate to the root — auth setup already injected a valid session via
  // storageState, so elitea-main should honour the authenticated redirect chain.
  await page.goto(BASE_URL + '/');

  // The root performs a 302 redirect to /app/, which then redirects the
  // authenticated user through IndexRoute → /chat (ROUTE-003 + ROUTE-007).
  await page.waitForURL('**/chat**', { timeout: 15_000 });
  // Exact landing path, not a `**/chat**` glob: the glob also matches e.g.
  // `/app/chat-something` or a nested chat route.
  expect(new URL(page.url()).pathname).toBe('/app/chat');

  // NOT `getByTestId('chat-send-button').or(getByTestId('chat-input'))`. Two
  // problems with that: an `.or()` passes on whichever half exists, and the
  // whole disjunction only proved that SOME element carrying one of two
  // testids was on screen. The composer is the thing this journey is about,
  // so assert the composer itself — and then that it is a live, editable
  // control, which no stub/placeholder route can produce.
  const composer = page.getByTestId('chat-input');
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // `features/chat-input/ui/UserInputEditableArea.tsx:96` wraps a real MUI
  // `TextField`; the inner textarea carries `chat-message-input` and the
  // "Type a message..." placeholder.
  const textarea = composer.getByTestId('chat-message-input');
  await expect(textarea).toBeEditable();
  await expect(textarea).toHaveAttribute('placeholder', 'Type a message...');

  // Typing must actually land in the composer — proves the chat feature is
  // mounted and interactive, not merely painted.
  await textarea.fill('probe-shell');
  await expect(textarea).toHaveValue('probe-shell');
  await textarea.fill('');

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 2: Login via OIDC honours target_to
// ─────────────────────────────────────────────────────────────────────────────
test('J2: OIDC login honours target_to deep link', async ({ browser }) => {
  // Use a fresh context (no pre-loaded auth) to exercise the full login flow.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // MEASURED PROPERTY OF THIS STACK (not an assumption): nginx serves the SPA
  // bundle for ANY /app/* path without an auth check, so navigating an
  // unauthenticated browser to a protected deep link does NOT produce an OIDC
  // redirect — the shell just loads with an empty session. The previous
  // revision of this test raced "did we get redirected to OIDC?" against "did
  // the agents page load?", and on this stack the second branch always won
  // instantly, so the OIDC half was dead and every assertion below it was
  // satisfied by an UNAUTHENTICATED page that happened to be at /agents. The
  // `.catch(() => null)` + `test.skip()` third branch then made even that
  // unreachable.
  //
  // What IS real, and is what JRNY-002 is actually about: elitea-main's
  // `/forward-auth/auth_oidc/login?target_to=<path>` encodes the target into
  // the OIDC `state` (`state=<nonce>|<target_to>`, verified against this
  // stack) and its callback lands the freshly-authenticated browser on that
  // path. That is the target_to contract; drive it end to end.
  const targetPath = '/app/artifacts';
  const loginResponse = await page.request.get(
    `${BASE_URL}/forward-auth/auth_oidc/login?target_to=${encodeURIComponent(targetPath)}`,
    { maxRedirects: 0 },
  );
  expect(loginResponse.status()).toBe(302);

  const location = loginResponse.headers()['location'];
  expect(location, 'login endpoint must 302 to the OIDC authorize endpoint').toBeTruthy();
  // The target must survive into the OIDC `state` — if elitea-main dropped it
  // here, no amount of post-login URL checking could tell us why.
  expect(decodeURIComponent(location!)).toContain(targetPath);

  // The browser cannot resolve the `oidc-mock` container hostname (same
  // rewrite auth.setup.ts performs).
  await page.goto(location!.replace('oidc-mock:9400', 'localhost:9400'), {
    waitUntil: 'domcontentloaded',
  });
  await page.getByLabel('Subject').fill('e2e-member@autotest.local');
  await page.getByRole('button', { name: 'Authorize', exact: true }).click();

  // After the callback the user must land on the originally requested path.
  await page.waitForURL(`**${targetPath}**`, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe(targetPath);
  // The auth_state redirect parameter must be stripped from the final URL.
  expect(page.url()).not.toContain('auth_state');

  // ...and the session the round trip established must be real. Without this
  // the URL assertions above would also pass for an unauthenticated shell
  // that was simply served the bundle at that path (which is exactly what
  // this stack does — see the note above).
  await expect(page.getByRole('button', { name: /Project:\s*Default Project/ })).toBeVisible({
    timeout: 20_000,
  });

  await checkA11y(page);
  await context.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 4: Logout → all el.* storage cleared
// ─────────────────────────────────────────────────────────────────────────────
test('J4: logout clears user state and el.* storage', async ({ page }) => {
  // KNOWN-RED. The app has no working logout.
  //
  //   * `src/routes/_shell/settings/settings-layout.tsx:68-72` renders a
  //     "Log out" item in the PERSONAL settings section.
  //   * `settings-layout.tsx:76-83` — its `handleItemClick` does nothing but
  //     `window.history.replaceState(null, '', '/settings/' + tabId)`. For
  //     `logout` that pushes a URL with no route behind it, and
  //     `SettingsRedirect` then bounces the user to
  //     /app/settings/model-configuration. Measured on this stack: clicking
  //     it leaves every `el.*` key in place and never leaves the app.
  //   * `src/shared/api/auth/logout.ts:27` `performLogout()` — the function
  //     that sweeps the `el.` namespace and hands the browser to
  //     `/forward-auth/logout` — is exported from
  //     `src/shared/api/auth/index.ts:32` and has NO call site anywhere in
  //     `src/` (only its own unit test). It is dead code.
  //
  // The previous revision hid this behind a try/catch whose `catch` branch
  // swept `el.*` itself with `page.evaluate` and then asserted that its own
  // sweep had worked — a test that passed by doing the product's job for it.
  // `test.fail()`, never `test.skip()`: every assertion still runs, and the
  // moment logout is wired this test reports FAILED (unexpected pass) instead
  // of quietly going on lying.
  // Tracked as #136: performLogout() (shared/api/auth/logout.ts:27) has NO call
  // site in src/. settings-layout.tsx:76-83 only replaceState()s to a path that
  // redirects back into the app, so el.* keys survive and the user never leaves.
  test.fail();

  await page.goto(BASE_URL + '/app/settings/personalization', { waitUntil: 'domcontentloaded' });

  // Wait for the settings drawer to be interactive before touching storage.
  const logoutItem = page.getByText('Log out', { exact: true });
  await expect(logoutItem).toBeVisible({ timeout: 20_000 });

  // A sentinel in the namespace performLogout() is contracted to sweep, plus
  // the two keys the app itself writes (`el.project.id` / `el.project.name`,
  // widgets/app-shell/lib/selectedProjectPersistence.ts).
  await page.evaluate(() => {
    window.localStorage.setItem('el.test-sentinel-shell', '1');
    window.sessionStorage.setItem('el.test-sentinel-shell', '1');
  });

  await logoutItem.click();

  // 1. Logout must leave the SPA — /forward-auth/logout, then the OIDC mock
  //    or the re-login entry point.
  await page.waitForURL(/localhost:9400|oidc-mock|\/forward-auth\/logout/, { timeout: 15_000 });

  // 2. ...and it must have swept the namespace on the way out. Read from the
  //    app origin, not from wherever the redirect landed.
  await page.goto(BASE_URL + '/app/', { waitUntil: 'domcontentloaded' });
  const survivingElKeys = await page.evaluate(() => {
    const keys: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith('el.')) keys.push(k);
      }
    }
    return keys;
  });
  expect(survivingElKeys).toEqual([]);
});
