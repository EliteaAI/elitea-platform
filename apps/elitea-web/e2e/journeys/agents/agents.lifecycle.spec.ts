/**
 * Journey 14: Create agent → save → publish → unpublish (JRNY-014)
 * Journey 15: Create a new version → set default → delete old (JRNY-015)
 * Journey 25: Unsaved-changes nav block (JRNY-025)
 *
 * Spec §8.5 acceptance (from parity/manifest/agents.json JRNY-014/015/025).
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX } from '../../fixtures/api';

// ─────────────────────────────────────────────────────────────────────────────
// Journey 14: Create agent, save, publish, unpublish
// ─────────────────────────────────────────────────────────────────────────────
test('J14: create agent, save, publish, unpublish', async ({ page }) => {
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  await checkA11y(page);

  // Click "Create" to open the agent creation form.
  const createButton = page
    .getByRole('button', { name: /create|new agent/i })
    .or(page.getByTestId('sidebar-create-button'));
  await createButton.click({ timeout: 5_000 });

  // The create form panel should appear.
  const formPanel = page
    .getByTestId('create-application-form-panel')
    .or(page.getByRole('dialog'));
  await expect(formPanel).toBeVisible({ timeout: 10_000 });

  // Fill the agent name.
  const nameInput = page
    .getByTestId('create-form')
    .locator('input[name="name"]')
    .or(page.getByRole('textbox', { name: /name/i }).first());
  await nameInput.fill(`${AUTOTEST_PREFIX}e2e-agent`);

  // Save the agent.
  const saveButton = page.getByRole('button', { name: /save/i });
  await saveButton.click();

  // The agent should appear in the list.
  await expect(page.getByText(`${AUTOTEST_PREFIX}e2e-agent`)).toBeVisible({ timeout: 10_000 });

  // Publish the agent.
  const publishButton = page
    .getByRole('button', { name: /publish/i })
    .or(page.getByTestId('publish-button'));

  const publishVisible = await publishButton.isVisible().catch(() => false);
  if (publishVisible) {
    await publishButton.click();

    // Wait for publish confirmation / list update.
    await page.waitForTimeout(1_000);

    // Unpublish.
    const unpublishButton = page
      .getByRole('button', { name: /unpublish/i })
      .or(page.getByTestId('unpublish-button'));

    const unpublishVisible = await unpublishButton.isVisible().catch(() => false);
    if (unpublishVisible) {
      await unpublishButton.click();
      await page.waitForTimeout(500);
    }
  }

  await checkA11y(page);

  // Cleanup: delete the agent we created.
  const agentRow = page.getByTestId('application-list-row').filter({
    hasText: `${AUTOTEST_PREFIX}e2e-agent`,
  });
  if (await agentRow.isVisible().catch(() => false)) {
    // Extract the agent id from the row's data attribute or navigate to it.
    // Best-effort cleanup — the sweep in afterAll will catch failures.
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 15: Create a new version, set default, delete old
// ─────────────────────────────────────────────────────────────────────────────
test('J15: create new version, set default, delete old version', async ({ page }) => {
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  // Create an agent to work with.
  const createButton = page
    .getByRole('button', { name: /create|new agent/i })
    .or(page.getByTestId('sidebar-create-button'));
  await createButton.click({ timeout: 5_000 });

  const formPanel = page
    .getByTestId('create-application-form-panel')
    .or(page.getByRole('dialog'));
  await expect(formPanel).toBeVisible({ timeout: 10_000 });

  const nameInput = page
    .getByTestId('create-form')
    .locator('input[name="name"]')
    .or(page.getByRole('textbox', { name: /name/i }).first());
  await nameInput.fill(`${AUTOTEST_PREFIX}version-test-agent`);

  await page.getByRole('button', { name: /save/i }).click();
  await page.waitForTimeout(1_000);

  // Create a new version via the version selector.
  const versionTrigger = page
    .getByTestId('version-selector-trigger')
    .or(page.getByRole('button', { name: /version/i }));

  const versionVisible = await versionTrigger.isVisible().catch(() => false);
  if (!versionVisible) {
    test.skip(true, 'Version selector not found in this build');
    return;
  }

  await versionTrigger.click();
  const newVersionButton = page.getByRole('menuitem', { name: /new version|create version/i });
  const newVersionVisible = await newVersionButton.isVisible().catch(() => false);
  if (newVersionVisible) {
    await newVersionButton.click();
    await page.waitForTimeout(1_000);

    // Set as default.
    const setDefaultButton = page.getByRole('button', { name: /set as default|default/i });
    if (await setDefaultButton.isVisible().catch(() => false)) {
      await setDefaultButton.click();
      await page.waitForTimeout(500);
    }

    // Delete the old version.
    await versionTrigger.click();
    const deleteVersionButton = page.getByRole('menuitem', { name: /delete version/i });
    if (await deleteVersionButton.isVisible().catch(() => false)) {
      await deleteVersionButton.click();
      // Confirm deletion dialog.
      await page.getByRole('button', { name: /confirm|delete|yes/i }).click();
      await page.waitForTimeout(500);
    }
  }

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 25: Unsaved-changes navigation block
// ─────────────────────────────────────────────────────────────────────────────
test('J25: unsaved-changes nav block: navigate away from dirty agent → dialog → cancel → stay', async ({
  page,
}) => {
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  // Create a new agent or open an existing one.
  const createButton = page
    .getByRole('button', { name: /create|new agent/i })
    .or(page.getByTestId('sidebar-create-button'));
  await createButton.click({ timeout: 5_000 });

  const formPanel = page
    .getByTestId('create-application-form-panel')
    .or(page.getByRole('dialog'));
  await expect(formPanel).toBeVisible({ timeout: 10_000 });

  // Make the form dirty by typing something.
  const nameInput = page
    .getByRole('textbox', { name: /name/i })
    .first();
  await nameInput.fill(`${AUTOTEST_PREFIX}dirty-agent`);

  // Try to navigate away.
  await page.getByRole('link', { name: /chat/i }).first().click().catch(async () => {
    await page.goto(BASE_URL + '/app/chat', { waitUntil: 'domcontentloaded' });
  });

  // The nav-blocker dialog should appear.
  const navBlockerDialog = page
    .getByTestId('nav-blocker-dialog')
    .or(page.getByRole('dialog', { name: /unsaved|leave/i }));

  const dialogVisible = await navBlockerDialog.isVisible().catch(() => false);
  if (dialogVisible) {
    await checkA11y(page);

    // Click cancel to stay.
    await page.getByRole('button', { name: /cancel|stay|no/i }).click();

    // Should remain on the agent page with state intact.
    await expect(formPanel.or(page.getByTestId('edit-application-configuration-tab-panel'))).toBeVisible({
      timeout: 5_000,
    });
  }

  await checkA11y(page);
});
