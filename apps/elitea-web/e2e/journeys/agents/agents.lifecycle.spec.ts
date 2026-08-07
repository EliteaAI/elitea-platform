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
import { AUTOTEST_PREFIX, clickCreateButton } from '../../fixtures/api';

import type { Page } from '@playwright/test';

/**
 * Opens the create-agent form and asserts the REAL form is on screen.
 *
 * Deliberately no `.or(getByRole('heading', …))` fallback: a heading is exactly
 * what a stub route renders, so accepting one means the journey passes against
 * an unimplemented screen. Three copies of that fallback lived in this file and
 * were the reason J14/J15/J25 could not tell a working page from a placeholder.
 */
async function openCreateAgentForm(page: Page): Promise<void> {
  await clickCreateButton(page);
  await expect(page.getByTestId('agent-name-input')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('agent-description-input')).toBeVisible();
}

/**
 * Fills both fields the create form requires. `applicationCreationSchema`
 * (entities/application-form/model/validation.ts) requires name AND
 * description; filling only the name leaves Save correctly disabled, which is
 * why J14/J15 used to time out clicking it.
 */
async function fillAgentForm(page: Page, name: string): Promise<void> {
  await page.getByTestId('agent-name-input').fill(name);
  await page.getByTestId('agent-description-input').fill(`${name} description`);
  await expect(page.getByTestId('agent-save-button')).toBeEnabled({ timeout: 5_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey 14: Create agent, save, publish, unpublish
// ─────────────────────────────────────────────────────────────────────────────
/*
 * NOT COVERED — publish / unpublish.
 *
 * JRNY-014 names them, and this test used to "cover" them with
 * `if (await publishButton.isVisible().catch(() => false))`, which silently
 * passed because no such control exists: a whole-tree grep for a publish or
 * unpublish affordance in `features/agents`/`pages/agents` finds only
 * notification COPY about publish events (`features/notifications/**`), never a
 * button. The optional block was coverage theatre, so it is gone and the test
 * is renamed to what it actually verifies. Publishing needs its own journey
 * once the UI exists.
 */
test('J14: create agent, save, and persist it', async ({ page }) => {
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  await checkA11y(page);

  await openCreateAgentForm(page);
  await fillAgentForm(page, `${AUTOTEST_PREFIX}e2e-agent`);

  await page.getByTestId('agent-save-button').click();

  // A real server round trip: the created agent must be addressable. This is
  // the assertion a heading-only route cannot satisfy — it requires the POST to
  // have succeeded and the router to have navigated to the new agent's id.
  await page.waitForURL(/\/agents\/[^/]+\/[^/]+/, { timeout: 15_000 });

  // Assert on the EDIT page's own panel, not just on a populated name input.
  // Proven necessary by mutation: with this route reverted to a heading-only
  // stub, `expect(agent-name-input).toHaveValue(...)` still PASSED — the create
  // page's input stays mounted under the parent route long enough to satisfy it,
  // so the journey went green against a stub. This testid exists only on
  // EditApplication, and (since the panel is no longer a self-closing Box) is
  // only non-empty when the real form is inside it.
  const editPanel = page.getByTestId('edit-application-configuration-tab-panel');
  await expect(editPanel).toBeVisible({ timeout: 10_000 });
  await expect(editPanel.getByTestId('agent-name-input')).toHaveValue(`${AUTOTEST_PREFIX}e2e-agent`);

  // And it must be listed back on the agents index — proving it was persisted,
  // not merely held in client state.
  await page.goto(BASE_URL + '/app/agents/my');
  await expect(page.getByText(`${AUTOTEST_PREFIX}e2e-agent`).first()).toBeVisible({ timeout: 15_000 });

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 15: Create a new version, set default, delete old
// ─────────────────────────────────────────────────────────────────────────────
/*
 * NARROWED, disclosed. JRNY-015 names "set default" and "delete old version".
 * Both were wrapped in `if (await x.isVisible().catch(() => false))`, so the
 * test passed whether or not those menu items existed. Rather than keep
 * assertions that cannot fail, this now hard-asserts the part that is real —
 * the version selector exists and lists the saved agent's version — and stops
 * claiming the rest. Set-default and delete-version need their own journey
 * written against the actual menu once its items are confirmed present.
 */
test('J15: a saved agent exposes a version selector listing its versions', async ({ page }) => {
  await page.goto(BASE_URL + '/app/agents/my');
  await page.waitForURL('**/agents**', { timeout: 15_000 });

  await openCreateAgentForm(page);
  await fillAgentForm(page, `${AUTOTEST_PREFIX}version-test-agent`);

  await page.getByTestId('agent-save-button').click();

  // Hard: the save must land on a real agent URL carrying an id.
  await page.waitForURL(/\/agents\/[^/]+\/[^/]+/, { timeout: 15_000 });

  // The version selector is the subject of this journey. It must exist — a
  // `test.skip('Version selector not found in this build')` here turned a
  // missing feature into a green run.
  const versionTrigger = page.getByTestId('version-selector-trigger');
  await expect(versionTrigger).toBeVisible({ timeout: 10_000 });

  // The saved agent starts at exactly one version, and the selector must name
  // it. A control that renders but lists nothing fails here.
  await versionTrigger.click();
  const versionOptions = page.getByRole('menuitem');
  await expect(versionOptions.first()).toBeVisible({ timeout: 5_000 });
  expect(await versionOptions.count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
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

  await openCreateAgentForm(page);

  // Dirty the form.
  await page.getByTestId('agent-name-input').fill(`${AUTOTEST_PREFIX}dirty-agent`);

  // Navigate away via a real in-app link (no goto() fallback: a hard navigation
  // bypasses the router's blocker entirely, so falling back to one would test
  // nothing while still passing).
  await page.getByRole('link', { name: /chat/i }).first().click();

  // The blocker dialog must appear. It used to be wrapped in
  // `if (dialogVisible)`, so an app with NO nav blocker passed this journey.
  const navBlockerDialog = page.getByRole('dialog');
  await expect(navBlockerDialog).toBeVisible({ timeout: 10_000 });
  await checkA11y(page);

  // Cancelling must keep us on the agent form with the typed value intact —
  // that is the actual guarantee JRNY-025 is about.
  await navBlockerDialog.getByRole('button', { name: /cancel|stay|no/i }).first().click();
  await expect(page.getByTestId('agent-name-input')).toHaveValue(`${AUTOTEST_PREFIX}dirty-agent`);
  expect(page.url()).toContain('/agents');

  await checkA11y(page);
});
