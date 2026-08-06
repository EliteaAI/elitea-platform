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
  // Navigate directly to the OIDC login endpoint — elitea-main redirects to
  // the mock's authorize page (the SPA doesn't do an automatic server redirect).
  // elitea-main is configured with OIDC_ISSUER_URL=http://oidc-mock:9400, which
  // causes it to redirect to http://oidc-mock:9400/oauth2/authorize. The browser
  // cannot resolve that container hostname, so we navigate to the login endpoint
  // with waitUntil:'commit' which resolves as soon as the server sends a 302.
  // We then extract the Location header URL and rewrite oidc-mock → localhost.
  const loginResponse = await page.request.get(BASE_URL + '/forward-auth/auth_oidc/login', {
    maxRedirects: 0,
  }).catch(() => null);

  const authorizeURL = loginResponse?.headers()['location']?.replace('oidc-mock:9400', 'localhost:9400')
    ?? (BASE_URL + '/forward-auth/auth_oidc/login');

  await page.goto(authorizeURL, { waitUntil: 'domcontentloaded' });

  // Wait for the OIDC mock's authorize page.
  await page.waitForURL(/localhost:9400|oidc-mock/, { timeout: 15_000 });

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
  const infoBody = await infoResponse.json() as { authenticated?: boolean };
  if (!infoBody.authenticated) {
    throw new Error(`OIDC session not authenticated for ${email}; info: ${JSON.stringify(infoBody)}`);
  }

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
