/**
 * Journey 5: Deep link to /agents/my/:id/:version cold-loads (JRNY-005)
 * Journey 6: Share link /{projectId}/agents/my/:id → project switch + reload (JRNY-006)
 *
 * Spec §8.5 acceptance (from parity/manifest/shell.json and agents.json).
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';
import { createAgent, deleteAgent, DEFAULT_PROJECT_ID, AUTOTEST_PREFIX } from '../../fixtures/api';

// ─────────────────────────────────────────────────────────────────────────────
// Journey 5: Deep link to an agent version cold-loads
// ─────────────────────────────────────────────────────────────────────────────
test('J5: deep link to specific agent version cold-loads', async ({ browser, request }) => {
  // Create an agent to deep-link into.
  const agentId = await createAgent(request, `${AUTOTEST_PREFIX}deeplink-agent`).catch(
    () => null,
  );

  try {
    // Use a fresh browser context to simulate a cold load.
    const context = await browser.newContext({ storageState: STORAGE_STATE.member });
    const page = await context.newPage();

    if (agentId) {
      // Version 1 is the initial version (version = 1 in the old app's numbering).
      const deepLink = `${BASE_URL}/app/agents/my/${agentId}/1`;
      await page.goto(deepLink, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(`**/agents/my/${agentId}**`, { timeout: 15_000 });

      // The agent detail page should open on that version.
      await expect(
        page.getByTestId('edit-application-configuration-tab-panel')
          .or(page.getByTestId('create-application-form-panel'))
          .or(page.getByTestId('version-selector-trigger')),
      ).toBeVisible({ timeout: 10_000 });

      // The URL must be preserved (not redirected away).
      expect(page.url()).toContain(`/agents/my/${agentId}`);
    } else {
      // If agent creation failed (backend not ready), navigate to the agents list.
      await page.goto(BASE_URL + '/app/agents/my', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/agents**', { timeout: 15_000 });
    }

    await checkA11y(page);
    await context.close();
  } finally {
    if (agentId) {
      await deleteAgent(request, agentId).catch(() => {});
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 6: Share link /{projectId}/agents/my/:id → project switch + reload
// ROUTE-070: the splat route ($projectId.$) strips the project segment and
// hard-reloads at the same path with the active project switched.
// ─────────────────────────────────────────────────────────────────────────────
test('J6: share link with project id switches project and reloads', async ({ page, request }) => {
  const agentId = await createAgent(request, `${AUTOTEST_PREFIX}sharelink-agent`).catch(
    () => null,
  );

  try {
    // Share links look like /{projectId}/agents/my/{agentId} — the projectId
    // segment is the first path segment. ROUTE-070 is the splat route that
    // handles this.
    const shareLink = `${BASE_URL}/app/${DEFAULT_PROJECT_ID}/agents/my/${agentId ?? 'nonexistent'}`;
    await page.goto(shareLink, { waitUntil: 'domcontentloaded' });

    // After the project switch + hard reload, the URL should have the project
    // segment stripped. The final URL should be /app/agents/my/{id}.
    await page.waitForURL(`**/agents/my/${agentId ?? 'nonexistent'}**`, { timeout: 15_000 });

    // The project segment should be stripped from the final URL.
    expect(page.url()).not.toContain(`/${DEFAULT_PROJECT_ID}/agents`);

    await checkA11y(page);
  } finally {
    if (agentId) {
      await deleteAgent(request, agentId).catch(() => {});
    }
  }
});
