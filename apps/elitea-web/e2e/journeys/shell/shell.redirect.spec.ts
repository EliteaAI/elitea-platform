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

  // The chat screen must be visible.
  await expect(page.getByTestId('chat-send-button').or(page.getByTestId('chat-input'))).toBeVisible({
    timeout: 10_000,
  });

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 2: Login via OIDC honours target_to
// ─────────────────────────────────────────────────────────────────────────────
test('J2: OIDC login honours target_to deep link', async ({ browser }) => {
  // Use a fresh context (no pre-loaded auth) to exercise the full login flow.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // target_to: deep link into the agents page (a known protected route).
  const targetPath = '/app/agents/my';
  await page.goto(BASE_URL + targetPath, { waitUntil: 'domcontentloaded' });

  // Should redirect to OIDC authorize.
  await page.waitForURL(/localhost:9400|oidc-mock/, { timeout: 15_000 });

  // Complete the OIDC login as the member persona.
  await page.getByLabel('Subject').fill('e2e-member@autotest.local');
  await page.getByRole('button', { name: 'Authorize' }).click();

  // After login the user should land on the originally requested path,
  // not the default /chat.
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  // The auth_state redirect parameter must be stripped from the final URL.
  expect(page.url()).not.toContain('auth_state');

  await checkA11y(page);
  await context.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 4: Logout → all el.* storage cleared
// ─────────────────────────────────────────────────────────────────────────────
test('J4: logout clears user state and el.* storage', async ({ page }) => {
  // Start on the app.
  await page.goto(BASE_URL + '/app/');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  // Write a sentinel key to verify the namespace sweep works.
  await page.evaluate(() => {
    window.localStorage.setItem('el.test-sentinel', '1');
  });

  // Trigger logout via the sidebar footer / user menu.
  // The old app had UserButton.jsx:32 → /forward-auth/logout.
  // The sidebar footer contains the user avatar/button.
  const userButton = page
    .getByTestId('sidebar-footer-user')
    .or(page.getByRole('button', { name: /logout|sign out/i }));

  // If there's no accessible logout button directly, fall back to navigating
  // to the logout URL directly (performLogout → /forward-auth/logout).
  try {
    await userButton.click({ timeout: 3_000 });
    await page.getByRole('menuitem', { name: /logout|sign out/i }).click();
  } catch {
    // Fall back to direct navigation as a last resort.
    await page.goto(BASE_URL + '/forward-auth/logout');
  }

  // After logout the user should reach the login / OIDC redirect.
  await page.waitForURL(/localhost:9400|oidc-mock|\/app\//, { timeout: 15_000 });

  // Verify that el.* keys were swept.
  const elKeys = await page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('el.')) keys.push(k);
    }
    return keys;
  });
  expect(elKeys).toHaveLength(0);
});
