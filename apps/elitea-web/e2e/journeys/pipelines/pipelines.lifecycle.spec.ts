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
   * RED BY DESIGN — real, critical `button-name` violations on this screen.
   *
   * axe reports two unnamed icon buttons (impact: critical, WCAG 4.1.2):
   *   - `features/pipelines/ui/GeneralFormPanel.tsx:97` — the left panel's
   *     collapse `<IconButton onClick={onClickCollapsed}>` wraps an icon only.
   *   - `features/pipelines/ui/ChatPanel.tsx:182` — the right panel's
   *     collapse `<IconButton onClick={onClickCollapsed}>`, same shape.
   * Neither carries `aria-label`, `title`, or visible text, so a screen
   * reader announces "button".
   *
   * Kept as its own test rather than folded into the journey above so the
   * journey's create/save/render assertions stay honestly GREEN — a
   * `test.fail()` wrapper around all of them would mask a regression in any
   * one of them. `checkA11y`'s own rule list is NOT extended to swallow
   * `button-name`: the violation is a finding, not noise.
   */
  // Tracked as #135 (a11y half): two critical button-name violations from
  // icon-only collapse buttons at GeneralFormPanel.tsx:97 and ChatPanel.tsx:182.
  test.fail();

  const name = `${AUTOTEST_PREFIX}a11y-${Date.now() % 1e9}`;
  await createPipelineThroughUi(page, name);
  await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 15_000 });

  await checkA11y(page);
});

test('J16: an edited flow graph survives a save + reload', async ({ page }) => {
  /*
   * RED BY DESIGN — acceptance (1) of JRNY-016 is not implemented.
   *
   * The node CAN be added (the assertion below the `Add node` click passes),
   * but `pages/pipelines/lib/useEditPipelineForm.ts:67-76` submits only
   * `toVersionDraft(activeVersion, conversationStarters)` — observed on the
   * wire as
   *   PUT /api/v2/elitea_core/version/prompt_lib/1/<id>/<id>
   *   {"name":"base","agent_type":"pipeline","instructions":"",
   *    "conversation_starters":[],"variables":[],"meta":{...}}
   * with no nodes/edges/pipeline_settings field at all. The gap is disclosed
   * in `EditPipeline.tsx`'s own doc comment ("no live node/edge state is
   * reachable to send even if the endpoint could carry it") and in
   * `lib/editPipelineMappers.ts`'s `toVersionDraft`. After a reload the
   * canvas is back to the single default `END` node.
   *
   * `test.fail()`, never `test.skip()`: this runs every assertion and turns
   * RED the moment graph persistence starts working, so it cannot outlive
   * the bug.
   */
  // Tracked as #135: useEditPipelineForm.ts:67-76 submits no nodes/edges, so the
  // PUT succeeds with 200 and the graph edit is silently lost on reload.
  test.fail();

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
