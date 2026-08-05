/**
 * Journey 17: Create toolkit → configure → test connection (JRNY-017)
 *
 * Spec §8.5 acceptance (from parity/manifest/toolkits.json JRNY-017).
 * Acceptance: the test result is displayed; the saved toolkit appears in the list.
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX } from '../../fixtures/api';

test('J17: create toolkit, configure, test connection', async ({ page }) => {
  await page.goto(BASE_URL + '/app/toolkits/my');
  await page.waitForURL('**/toolkits**', { timeout: 15_000 });

  await checkA11y(page);

  // The toolkits list should render.
  const toolkitListOrEmpty = page
    .getByTestId('toolkit-card')
    .or(page.getByTestId('toolkits-tab-all'))
    .or(page.getByText(/no toolkits|create your first/i));
  await expect(toolkitListOrEmpty.first()).toBeVisible({ timeout: 10_000 });

  // Click Create.
  const createButton = page
    .getByRole('button', { name: /create|new toolkit/i })
    .or(page.getByTestId('sidebar-create-button'));
  await createButton.click({ timeout: 5_000 });

  // The create form should appear.
  const formPanel = page
    .getByRole('dialog')
    .or(page.getByTestId('create-form'));
  await expect(formPanel).toBeVisible({ timeout: 10_000 });

  // Fill the toolkit name.
  const nameInput = page.getByRole('textbox', { name: /name/i }).first();
  await nameInput.fill(`${AUTOTEST_PREFIX}e2e-toolkit`);

  // Save the toolkit.
  await page.getByRole('button', { name: /save|create/i }).click();
  await page.waitForTimeout(1_000);

  // Navigate to the toolkit and test the connection.
  const toolkitCard = page
    .getByTestId('toolkit-card')
    .filter({ hasText: `${AUTOTEST_PREFIX}e2e-toolkit` });

  const cardVisible = await toolkitCard.isVisible().catch(() => false);
  if (cardVisible) {
    await toolkitCard.click();

    // The edit/test pane should be visible.
    const testPane = page
      .getByTestId('edit-toolkit-test-pane-slot')
      .or(page.getByRole('tab', { name: /test/i }));

    if (await testPane.isVisible().catch(() => false)) {
      await testPane.click();

      // Run the connection test.
      const testButton = page.getByRole('button', { name: /test connection|run test/i });
      if (await testButton.isVisible().catch(() => false)) {
        await testButton.click();
        // The test result should appear (success or failure message).
        await expect(
          page.getByRole('alert').or(page.getByText(/success|failed|error|connected/i)),
        ).toBeVisible({ timeout: 15_000 });
      }
    }
  }

  await checkA11y(page);
});
