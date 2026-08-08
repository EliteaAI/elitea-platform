/**
 * Journey 3: Session expiry mid-request → re-auth popup → retry (JRNY-003)
 * Journey 7: Project switch from the sidebar (JRNY-007)
 *
 * Spec §8.5 acceptance (from parity/manifest/shell.json JRNY-003/007).
 *
 * NOT TESTABLE ON THIS STACK — recorded here rather than faked anywhere
 * below: `deploy/docker-compose.e2e.yml:38` sets `VITE_SOCKET_SERVER: ""`,
 * so the app installs the noop socket client whose connection state is the
 * hardcoded literal `disconnected`. Any assertion about live socket
 * connection/reconnect behaviour (the sidebar's `sidebar-connection-dot`
 * included) would be asserting against a constant, not against the product.
 * Neither journey in this file depends on it.
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';

// ─────────────────────────────────────────────────────────────────────────────
// Journey 3: Session expiry → re-auth popup → retry
// ─────────────────────────────────────────────────────────────────────────────
test('J3: session expiry triggers re-auth popup and retries original request', async ({ page }) => {
  // KNOWN-RED. The re-auth popup can never open in this app: nothing wires
  // the controller into the client that actually makes the requests.
  //
  //   * `src/shared/api/http.ts:139` `needsReauth()` treats 401/403 as
  //     "re-auth needed", and `http.ts:265-267` runs the flow — but only
  //     `if (reauthenticate === undefined) return Promise.resolve(false);`
  //     does not short-circuit first.
  //   * `src/app/App.tsx:72` is the ONLY bootstrap call site:
  //     `configureGeneratedClient({ baseUrl: config.config.vite_server_url })`
  //     — no `reauthenticate` key. Every generated hook shares that one
  //     client, so `reauthenticate` is `undefined` for the entire app and
  //     the 401 branch returns false without opening anything.
  //   * `createAuthPopupController` (`src/shared/api/auth/popup.ts:90`) has
  //     no production call site at all — `grep -rn 'reauthenticate' src/`
  //     outside its own module and tests returns only doc comments and
  //     `routes/auth-callback.tsx:58`, which deliberately omits it.
  //
  // The previous revision opened with `page.waitForEvent('popup').catch(() =>
  // null)` and then wrapped its whole body in `if (popup) { … }`, so the
  // never-opening popup was simply skipped and the test fell through to a
  // bare `checkA11y(page)` — it passed by asserting nothing about JRNY-003.
  // `test.fail()`, never `test.skip()`: the assertions below run for real and
  // this test flips to FAILED the day the popup is wired.
  // Tracked as #136: App.tsx:72 configures the client with no `reauthenticate`,
  // so http.ts:266 returns false immediately and needsReauth() is dead for every
  // 401/403. createAuthPopupController has no production call site.
  test.fail();

  await page.goto(BASE_URL + '/app/');
  await page.waitForURL('**/chat**', { timeout: 15_000 });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 });

  // Expire the session for every subsequent API call.
  await page.route('**/api/v2/**', async (route) => {
    await route.fulfill({ status: 401, body: 'Unauthorized', contentType: 'text/plain' });
  });

  const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });

  // Navigate somewhere that must fetch — the agents list issues an API call
  // on mount, which now 401s.
  await page.goto(BASE_URL + '/app/agents/all', { waitUntil: 'commit' });

  // 1. The re-auth popup must open, at the OIDC authorize endpoint.
  const popup = await popupPromise;
  await popup.waitForURL(/localhost:9400|oidc-mock|\/forward-auth\/auth_oidc/, { timeout: 15_000 });

  // 2. Completing re-auth in the popup must close it...
  await popup.getByLabel('Subject').fill('e2e-member@autotest.local');
  await popup.getByRole('button', { name: 'Authorize', exact: true }).click();
  await popup.waitForEvent('close', { timeout: 15_000 });

  // 3. ...and the original request must be retried and succeed. Stop
  //    401-ing so the retry can land, then assert the page recovered with
  //    real content rather than an error state.
  await page.unroute('**/api/v2/**');
  await expect(page.getByTestId('sidebar-create-button')).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText(/something went wrong|unauthorized/i)).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 7: Project switch from the sidebar
// ─────────────────────────────────────────────────────────────────────────────
/**
 * SECOND PROJECT IS A BACKEND STUB, DELIBERATELY — and it is the backend
 * that is stubbed, not the UI under test.
 *
 * The E2E seed contains exactly ONE project ("Default Project", id 1) for
 * both personas (measured: the switcher's listbox renders a single option
 * for `member` and for `admin`), and elitea-main exposes no way to make a
 * second one — `services/elitea-main/internal/api/v2/projects/handler.go`
 * serves `GET /api/v2/projects/project/default/{id}` and nothing else; there
 * is no create/delete project route to add a real `-shell` project with.
 * A switch journey against a one-item list asserts nothing, which is exactly
 * how the previous revision passed: it read `isVisible().catch(() => false)`,
 * then `if (!isVisible) return;`, then `if (count > 1)` — three nested
 * escapes, and on this stack `count` is 1, so the switch never ran.
 *
 * So the project LIST response gets a second row appended. Everything from
 * the switcher trigger inward is the real product: `ProjectSwitcher`'s
 * popper, `AppShell`'s `selectProject`, and
 * `widgets/app-shell/lib/selectedProjectPersistence.ts`'s `el.project.*`
 * writes. If any of those regress, this test fails.
 */
const SWITCH_TARGET_ID = '9901';
const SWITCH_TARGET_NAME = 'autotest_switch-shell';

test('J7: project switch from the sidebar', async ({ page }) => {
  await page.route('**/api/v2/projects/project/default/**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body), 'project list must be a bare array').toBe(true);
    expect(body.length, 'the seed must still contain Default Project').toBeGreaterThan(0);
    await route.fulfill({
      response,
      json: [...body, { ...body[0], id: Number(SWITCH_TARGET_ID), name: SWITCH_TARGET_NAME }],
    });
  });

  await page.goto(BASE_URL + '/app/');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  // The switcher trigger is the sidebar's "Project: <name>" button
  // (`widgets/sidebar/ui/ProjectSwitcher.tsx:66-88`). Asserting its
  // accessible name proves the selected project is really rendered, not just
  // that some button exists.
  const trigger = page.getByRole('button', { name: /Project:/ });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await expect(trigger).toHaveAccessibleName(/Project:\s*Default Project/, { timeout: 20_000 });

  await checkA11y(page);

  await trigger.click();

  // The popper is `open={open && projects.length > 0}` — a listbox with BOTH
  // projects in it, not merely "some listbox/dialog/menu appeared".
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  await expect(listbox.getByRole('option')).toHaveCount(2);

  const target = listbox.getByRole('option', { name: SWITCH_TARGET_NAME });
  await expect(target).toHaveAttribute('aria-selected', 'false');
  await target.click();

  // 1. The switch is reflected in the trigger...
  await expect(trigger).toHaveAccessibleName(new RegExp(`Project:\\s*${SWITCH_TARGET_NAME}`), {
    timeout: 10_000,
  });
  // ...and the popper closed.
  await expect(listbox).toHaveCount(0);

  // 2. ...and persisted, in both storage areas
  //    (`selectedProjectPersistence.ts` writes local AND session).
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('el.project.id')), { timeout: 10_000 })
    .toBe(SWITCH_TARGET_ID);
  expect(await page.evaluate(() => window.localStorage.getItem('el.project.name'))).toBe(
    SWITCH_TARGET_NAME,
  );
  expect(await page.evaluate(() => window.sessionStorage.getItem('el.project.id'))).toBe(
    SWITCH_TARGET_ID,
  );

  // 3. ...and survives a reload, with the shell still mounted.
  await page.reload();
  await expect(page.getByTestId('sidebar-collapse-toggle')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Project:/ })).toHaveAccessibleName(
    new RegExp(`Project:\\s*${SWITCH_TARGET_NAME}`),
    { timeout: 20_000 },
  );

  // Leave the persona on the seeded project so a later spec sharing this
  // stack does not inherit the stubbed id.
  await page.evaluate(() => {
    for (const store of [window.localStorage, window.sessionStorage]) {
      store.removeItem('el.project.id');
      store.removeItem('el.project.name');
    }
  });
});
