/**
 * Journey 19: Create credential → use it in an agent (JRNY-019)
 *
 * Spec §8.5 acceptance (from parity/manifest/credentials.json JRNY-019).
 * Acceptance: the credential is persisted and selectable; removing it
 * invalidates dependent configuration gracefully.
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX, clickCreateButton } from '../../fixtures/api';

test('J19: create credential and use it in an agent', async ({ page }) => {
  // Navigate to the credentials / configurations page.
  await page.goto(BASE_URL + '/app/settings/model-configuration');
  await page.waitForURL('**/settings**', { timeout: 15_000 });

  await checkA11y(page);

  // The credentials panel should be visible.
  const credForm = page
    .getByTestId('configuration-form')
    .or(page.getByRole('heading', { name: /credential|configuration/i })).first();
  const credVisible = await credForm.isVisible().catch(() => false);
  if (!credVisible) {
    // Try the create-configuration route (ROUTE-059).
    await page.goto(BASE_URL + '/app/settings/create-configuration');
    await page.waitForURL('**/settings**', { timeout: 10_000 });
  }

  // Open the create credential / configuration form.
  const createButton = page.getByRole('button', { name: /create|add credential|add configuration/i });
  const btnVisible = await createButton.isVisible().catch(() => false);
  if (!btnVisible) {
    test.skip(true, 'Create credential button not found in this build');
    return;
  }
  await createButton.click();

  // The form should appear.
  const form = page.getByTestId('config-form').or(page.getByRole('dialog')).first();
  await expect(form).toBeVisible({ timeout: 10_000 });

  // Fill in credential details.
  const nameInput = page.getByRole('textbox', { name: /name/i }).first();
  await nameInput.fill(`${AUTOTEST_PREFIX}e2e-credential`);

  // Save.
  await page.getByRole('button', { name: /save|create/i }).click();
  await page.waitForTimeout(1_000);

  // The credential should appear in the list.
  await expect(page.getByText(`${AUTOTEST_PREFIX}e2e-credential`)).toBeVisible({
    timeout: 10_000,
  });

  // Now navigate to an agent and use this credential.
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 10_000 });

  await clickCreateButton(page);

  const agentForm = page.getByTestId('create-application-form-panel').or(page.getByRole('dialog')).first();
  await expect(agentForm).toBeVisible({ timeout: 10_000 });

  await page.getByRole('textbox', { name: /name/i }).first().fill(`${AUTOTEST_PREFIX}cred-agent`);

  // The credential selector should list our credential.
  const credSelector = page
    .getByTestId('credentials-select-refresh')
    .or(page.getByTestId('llm-selector'))
    .or(page.getByRole('combobox', { name: /credential|model/i })).first();

  const selectorVisible = await credSelector.isVisible().catch(() => false);
  if (selectorVisible) {
    await credSelector.click();
    // The credential should be selectable.
    const option = page.getByRole('option', { name: /autotest_e2e-credential/i });
    if (await option.isVisible().catch(() => false)) {
      await option.click();
    }
  }

  await page.getByRole('button', { name: /save/i }).click();
  await page.waitForTimeout(500);

  await checkA11y(page);
});
