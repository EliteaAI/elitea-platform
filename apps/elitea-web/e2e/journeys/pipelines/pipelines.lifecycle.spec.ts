/**
 * Journey 16: Create pipeline → edit flow graph → save (JRNY-016)
 *
 * Spec §8.5 acceptance (from parity/manifest/pipelines.json JRNY-016):
 *   (1) the saved pipeline reloads with the same graph;
 *   (2) validation errors block saving with a visible reason.
 *
 * ── Why this file no longer contains a single `.or()` chain ──────────────
 * The previous version accepted `getByRole('heading', {name: /create
 * pipeline/i})` as a substitute for the create form, and wrapped every
 * subsequent step in `if (!hasForm) return;` / `.catch(() => false)`. Under
 * that shape a route that rendered nothing but an `<h5>` reported green —
 * and it did exactly that for as long as `CreatePipeline.tsx` shipped a
 * self-closing `<Box data-testid="create-pipeline-form-panel" />`. Every
 * assertion below now names something a stub cannot produce: a specific
 * form control, a backend-minted SERIAL id in the URL, a React-Flow node
 * element, or a name echoed back by the detail fetch.
 */
import { test, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX, clickCreateButton, deleteAgent } from '../../fixtures/api';

/** Application ids minted by the tests below, deleted in `afterEach`. */
const createdIds: string[] = [];

test.afterEach(async ({ page }) => {
  while (createdIds.length > 0) {
    const id = createdIds.pop();
    if (id !== undefined) await deleteAgent(page.request, id);
  }
});

/**
 * Drive the REAL create form to completion and return the application id the
 * backend assigned. Everything here is a hard assertion — there is no
 * "the route may still be a placeholder" branch, because a placeholder is
 * precisely the failure this journey exists to catch.
 */
async function createPipelineThroughUi(page: Page, name: string): Promise<string> {
  await page.goto(BASE_URL + '/app/pipelines/my');
  await page.waitForURL('**/pipelines**', { timeout: 15_000 });
  await checkA11y(page);

  await clickCreateButton(page);
  await page.waitForURL('**/app/pipelines/create**', { timeout: 15_000 });

  // The panel must CONTAIN the real controls. `toBeVisible()` on the panel
  // alone is what let the hollow version ship (see CreatePipeline.test.tsx's
  // own comment on the same trap): an empty <Box> is in the document, and
  // an <h5> is visible.
  const panel = page.getByTestId('create-pipeline-form-panel');
  const nameInput = panel.getByTestId('agent-name-input');
  const descriptionInput = panel.getByTestId('agent-description-input');
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await expect(descriptionInput).toBeVisible();

  const saveButton = page.getByTestId('pipeline-save-button');

  // Acceptance (2): a validation error blocks the save AND states a reason.
  // Fill both fields first so the "blocked" state below is demonstrably
  // reached by clearing a field, not merely by the form being untouched.
  await nameInput.fill(name);
  await descriptionInput.fill(`${AUTOTEST_PREFIX}JRNY-016 pipeline`);
  await expect(saveButton).toBeEnabled();

  await nameInput.fill('');
  await expect(saveButton).toBeDisabled();
  await expect(panel.getByText('Name is required')).toBeVisible();

  await nameInput.fill(name);
  await expect(panel.getByText('Name is required')).toHaveCount(0);
  await expect(saveButton).toBeEnabled();

  await checkA11y(page);
  await saveButton.click();

  // A SERIAL id minted by POST /elitea_core/applications — nothing the
  // frontend can invent, so this URL cannot be satisfied by a stub route.
  await page.waitForURL(/\/app\/pipelines\/latest\/\d+/, { timeout: 20_000 });
  const id = /\/app\/pipelines\/latest\/(\d+)/.exec(page.url())?.[1];
  expect(id, 'create must navigate to the backend-assigned pipeline id').toBeTruthy();
  createdIds.push(id as string);
  return id as string;
}

test('J16: create a pipeline through the real form and land on a live flow editor', async ({ page }) => {
  // `MAX_NAME_LENGTH` (CreateAgentForm.tsx:147) is 32 — keep the unique
  // suffix short so the value asserted on is the value actually stored.
  const name = `${AUTOTEST_PREFIX}pipe-${Date.now() % 1e9}`;
  await createPipelineThroughUi(page, name);

  // The editor page, not a shell. `pipeline-config-tab` is GeneralFormPanel.tsx:93;
  // `rf__wrapper`/`rf__node-END` are emitted by a mounted @xyflow/react canvas
  // holding the default pipeline state — a stub page renders neither.
  await expect(page.getByTestId('pipeline-config-tab')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rf__wrapper')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible();

  // Backend-derived: EditPipeline.tsx renders `pipelineDetailDisplayName(detail)`
  // from the GET application-detail response, not from anything it navigated with.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 });
});

test('J16: the pipeline editor screen is accessible (spec §6.4)', async ({ page }) => {
  /*
   * Was RED — two critical `button-name` violations (WCAG 4.1.2) from the
   * icon-only collapse buttons in `features/pipelines/ui/GeneralFormPanel.tsx`
   * and `features/pipelines/ui/ChatPanel.tsx`, neither carrying an
   * `aria-label`, `title`, or visible text. Both now carry a state-tracking
   * `aria-label` (#135), so axe reports a clean screen.
   *
   * Kept as its own test rather than folded into the journey above so a
   * future a11y regression names itself instead of failing somewhere inside
   * the create/save path. `checkA11y`'s own rule list is NOT extended to
   * swallow `button-name`: a violation here is a finding, not noise.
   */
  const name = `${AUTOTEST_PREFIX}a11y-${Date.now() % 1e9}`;
  await createPipelineThroughUi(page, name);
  await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 15_000 });

  await checkA11y(page);
});

test('J16: an edited flow graph survives a save + reload', async ({ page }) => {
  /*
   * JRNY-016 acceptance (1). This was RED: the save submitted only
   * `toVersionDraft(activeVersion, conversationStarters)`, so the PUT carried
   * no nodes, no edges and no `pipeline_settings`, answered 200, and the
   * canvas came back as the single default `END` node on reload.
   *
   * Fixed end to end in #135 — `pipeline_settings` added to
   * `VersionWriteRequest` (services/elitea-main/api/openapi/v2.yaml) and
   * persisted by `UpdateVersion`; the page seeds the flow-editor stores from
   * the loaded version and sends the live graph (`instructions` = the pipeline
   * YAML) back on save.
   */
  const name = `${AUTOTEST_PREFIX}graph-${Date.now() % 1e9}`;
  const id = await createPipelineThroughUi(page, name);

  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible({ timeout: 15_000 });

  // Edit the graph: add an Agent node through the editor's own menu.
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Agent', exact: true }).click();
  const addedNode = page.locator('.react-flow__node[data-id="Agent 1"]');
  await expect(addedNode).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('pipeline-save-button').click();
  // No toast infrastructure exists; a failed save renders a role="alert"
  // banner (EditPipeline.tsx). Assert the save did not error.
  await expect(page.getByText('Failed to save your changes.')).toHaveCount(0);

  await page.goto(BASE_URL + `/app/pipelines/latest/${id}`);
  // The reload really did re-fetch this pipeline (backend-derived name).
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible({ timeout: 15_000 });

  // Acceptance (1): the saved pipeline reloads with the SAME graph.
  await expect(addedNode).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 25 (pipelines half): Unsaved-changes navigation block
// ─────────────────────────────────────────────────────────────────────────────
test('J25: unsaved-changes nav block: navigate away from a dirty pipeline → dialog → cancel → stay', async ({
  page,
}) => {
  /*
   * The `/pipelines` half of #133. The issue's agents half was measured (J25
   * in `agents.lifecycle.spec.ts`); the pipelines half was INFERENCE — the
   * identical "nav-blocking-when-dirty is dropped" disclosure sat in
   * `EditPipeline.tsx` with no test exercising it. This journey measures it.
   *
   * The dialog asserted on is the REAL production `NavBlockerDialog`
   * (`widgets/app-shell`), armed by `CreatePipeline.tsx`'s own
   * `useUnsavedChangesNavBlocker` call. Nothing here stubs the served bundle.
   */
  await page.goto(BASE_URL + '/app/pipelines/my');
  await page.waitForURL('**/pipelines**', { timeout: 15_000 });

  await clickCreateButton(page);
  await page.waitForURL('**/app/pipelines/create**', { timeout: 15_000 });

  const panel = page.getByTestId('create-pipeline-form-panel');
  const nameInput = panel.getByTestId('agent-name-input');
  await expect(nameInput).toBeVisible({ timeout: 10_000 });

  // Dirty the form.
  const dirtyName = `${AUTOTEST_PREFIX}dirty-pipe`;
  await nameInput.fill(dirtyName);

  // A real in-app link. A `goto()` fallback would bypass the router's blocker
  // entirely and pass against an app with no guard at all.
  await page.getByRole('link', { name: /chat/i }).first().click();

  const navBlockerDialog = page.getByRole('dialog');
  await expect(navBlockerDialog).toBeVisible({ timeout: 10_000 });
  await checkA11y(page);

  // Cancelling keeps us on the pipeline form with the typed value intact.
  await navBlockerDialog.getByRole('button', { name: /cancel|stay|no/i }).first().click();
  await expect(nameInput).toHaveValue(dirtyName);
  expect(page.url()).toContain('/pipelines');

  await checkA11y(page);
});
