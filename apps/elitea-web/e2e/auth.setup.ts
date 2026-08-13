/**
 * Global auth setup (issue #60, unit V1 spec §OIDC).
 *
 * Performs a real OIDC authorization-code round trip via oidc-provider-mock:
 *   1. Navigate to the app → elitea-main redirects to the mock's authorize endpoint.
 *   2. Fill the "Subject" field with the persona's email and click "Authorize".
 *   3. The mock redirects back through /forward-auth/auth_oidc/callback →
 *      elitea-main sets the session cookie → app loads.
 *   4. Save storageState per persona so the 30 journey specs reuse the
 *      authenticated session without re-logging in for every test.
 *
 * The vite_dev_token bypass was deliberately removed (spec C7b, waiver W-001);
 * this is the only way E2E tests can authenticate.
 */
import { mkdirSync } from 'fs';
import * as path from 'path';

import { test as setup, expect } from '@playwright/test';

import { BASE_URL, STORAGE_STATE } from '../playwright.config';

setup.describe('Auth setup', () => {
  setup.beforeAll(() => {
    // Ensure the state directory exists.
    const dir = path.dirname(STORAGE_STATE.member);
    mkdirSync(dir, { recursive: true });
  });

  setup('authenticate as member persona', async ({ page }) => {
    setup.setTimeout(60_000);
    await performOidcLogin(page, 'e2e-member@autotest.local', STORAGE_STATE.member);
  });

  setup('authenticate as admin persona', async ({ page }) => {
    setup.setTimeout(60_000);
    await performOidcLogin(page, 'e2e-admin@autotest.local', STORAGE_STATE.admin);
  });

  // The #284 chat driver. Its personal project is what the /llm hop resolves
  // the provider credential from, which is why it cannot be one of the two
  // personas above — see `playwright.config.ts`'s STORAGE_STATE.chat.
  setup('authenticate as chat-driver persona', async ({ page }) => {
    setup.setTimeout(60_000);
    await performOidcLogin(page, 'e2e-chat@autotest.local', STORAGE_STATE.chat);
  });
});

/**
 * Drives a full OIDC authorization-code flow via oidc-provider-mock.
 *
 * The mock's authorize screen shows a simple form with a "Subject" text input
 * and an "Authorize" button (no password). Filling the email and clicking
 * Authorize completes the flow.
 */
async function performOidcLogin(
  page: import('@playwright/test').Page,
  email: string,
  storageStatePath: string,
): Promise<void> {
  // Navigate to the OIDC login endpoint — elitea-main redirects to the mock's
  // authorize page (the SPA does no automatic server redirect of its own).
  //
  // No hostname rewrite any more. `OIDC_ISSUER_URL` used to be the
  // compose-internal `http://oidc-mock:9400`, so the authorize URL
  // elitea-main handed out was unreachable from the host browser and this
  // setup had to read the `Location` header itself and rewrite the host. It is
  // `http://oidc.localhost:${E2E_OIDC_PORT}` now — a network alias on the oidc-mock
  // service that resolves to the container inside the compose network and to
  // loopback from the host (see `deploy/docker-compose.e2e-standalone.yml`) —
  // so a plain navigation follows the whole chain. That change is what made
  // J3's re-auth popup possible at all: a redirect the BROWSER follows on its
  // own cannot be rewritten from the test side.
  await page.goto(BASE_URL + '/forward-auth/auth_oidc/login', {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the OIDC mock's authorize page.
  //
  // The port is read from the environment rather than hardcoded so a second
  // stack (E2E_OIDC_PORT) can be driven by the same suite; the default is the
  // 9400 every existing invocation already uses.
  await page.waitForURL(new RegExp(`oidc\\.localhost:${process.env['E2E_OIDC_PORT'] ?? '9400'}`), {
    timeout: 15_000,
  });

  // oidc-provider-mock authorize form: fill Subject (the user's email) and submit.
  // The field label is "Subject" per the mock's default template.
  await page.getByLabel('Subject').fill(email);
  await page.getByRole('button', { name: 'Authorize', exact: true }).click();

  // The mock redirects back through elitea-main's callback handler, which sets
  // the session cookie and ultimately lands the user on the app.
  await page.waitForURL(BASE_URL + '/**', { timeout: 15_000 });

  // Verify session is valid by calling the session info endpoint directly.
  // The SPA router context is not yet wired to a session store (Wave-2 gap),
  // so we cannot rely on sidebar-toggle rendering; instead, /forward-auth/info
  // confirms the server-side cookie round-trip succeeded.
  const infoResponse = await page.request.get(BASE_URL + '/forward-auth/info');
  const infoBody = (await infoResponse.json()) as { authenticated?: boolean; user_id?: string };
  expect(
    infoBody,
    `OIDC session not authenticated for ${email}; info: ${JSON.stringify(infoBody)}`,
  ).toMatchObject({ authenticated: true });
  // A session with no subject would still satisfy `authenticated: true` but
  // leaves every downstream journey without an identity to assert against.
  expect(infoBody.user_id, `OIDC session for ${email} carries no user_id`).toBeTruthy();

  // Seed the selected project into localStorage/sessionStorage so tests start
  // with an active project — prevents the create button from being disabled.
  // AppShell normally auto-selects via GET /social/author → personal_project_id,
  // but that async waterfall may not complete before tests access the create
  // button. We write the default project (id=1) directly so the store hydrates
  // from storage immediately on the next page load.
  //
  // We do this while on the BASE_URL domain so the evaluate runs in the right
  // storage origin. The SPA may still be redirecting after the OIDC callback —
  // navigate to /app/ to stabilize, then write storage.
  await page.goto(BASE_URL + '/app/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.evaluate(() => {
    localStorage.setItem('el.project.id', '1');
    localStorage.setItem('el.project.name', 'Default Project');
    sessionStorage.setItem('el.project.id', '1');
    sessionStorage.setItem('el.project.name', 'Default Project');
  });

  // Save the authenticated state (cookies + localStorage).
  await page.context().storageState({ path: storageStatePath });
}
