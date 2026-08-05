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
    await performOidcLogin(page, 'e2e-member@autotest.local', STORAGE_STATE.member);
  });

  setup('authenticate as admin persona', async ({ page }) => {
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
  // Navigate to the app root — elitea-main should redirect unauthenticated
  // requests to the OIDC authorize endpoint.
  await page.goto(BASE_URL + '/app/', { waitUntil: 'domcontentloaded' });

  // Wait for the redirect to the OIDC mock's authorize page.
  await page.waitForURL(/localhost:9400|oidc-mock/, { timeout: 15_000 });

  // oidc-provider-mock authorize form: fill Subject (the user's email) and submit.
  // The field label is "Subject" per the mock's default template.
  await page.getByLabel('Subject').fill(email);
  await page.getByRole('button', { name: 'Authorize' }).click();

  // The mock redirects back through elitea-main's callback handler, which sets
  // the session cookie and ultimately lands the user on the app.
  await page.waitForURL(BASE_URL + '/**', { timeout: 15_000 });

  // Verify we're actually authenticated — the app shell should be visible.
  // The sidebar is the most reliable shell indicator.
  await expect(page.getByTestId('sidebar-toggle').or(page.getByTestId('sidebar-collapse-toggle'))).toBeVisible({
    timeout: 10_000,
  });

  // Save the authenticated state (cookies + localStorage).
  await page.context().storageState({ path: storageStatePath });
}
