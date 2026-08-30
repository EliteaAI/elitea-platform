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
import { AUTOTEST_PREFIX, DEFAULT_PROJECT_ID, clickCreateButton, deleteAgent } from '../../fixtures/api';
import {
  COMPILER_LEGAL_NODE_ID,
  parseStoredGraph,
  readStoredPipelineVersion,
  resolveLatestPipelineVersionId,
  storedNodeIds,
} from '../../fixtures/pipelines';

/**
 * The Add-node menu labels for the nine node types the Rust pipeline
 * compiler admits (`parse_pipeline_node`,
 * `services/elitea-worker-rust/src/agents/graph/compiler.rs:1236`).
 * `Code` and `Custom` are deliberately NOT here: the compiler has no arm for
 * either, so a pipeline containing one cannot load.
 */
const ADMITTED_NODE_LABELS = [
  'Agent',
  'Decision',
  'Human-in-the-loop',
  'LLM',
  'MCP',
  'Printer',
  'Router',
  'State modifier',
  'Toolkit',
] as const;

/**
 * The subset of {@link ADMITTED_NODE_LABELS} whose seeded defaults are
 * COMPLETE the moment the node is added, so a pipeline holding them can be
 * saved with no further configuration.
 *
 * The three that are missing — Agent, Toolkit, MCP — are missing on purpose,
 * and their absence is a statement about this change rather than a gap in
 * it. Their runtime-required fields (`tool` for an Agent,
 * `toolkit_name`+`tool` for a direct tool) are seeded EMPTY: the runtime
 * calls the Agent one a participant alias (`application.rs:49`) and nothing
 * pins which string resolves, and a toolkit binding is a user choice, so the
 * editor asks rather than guesses. The editor's own validation then refuses
 * to save until they are filled — which is exactly the intended "empty and
 * required" behaviour, and means a stored-document assertion cannot cover
 * them without first driving a toolkit picker. Their minted ids are checked
 * on the canvas by the test below instead.
 */
const SAVEABLE_NODE_LABELS = ADMITTED_NODE_LABELS.filter(
  label => label !== 'Agent' && label !== 'Toolkit' && label !== 'MCP',
);

/** Add one node of `label` through the editor's own menu — no store pokes. */
async function addNodeThroughMenu(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** Click Save and wait for the version PUT to actually land, not just for the click. */
async function saveAndAwaitPersist(page: Page): Promise<void> {
  const persisted = page.waitForResponse(
    response =>
      response.request().method() === 'PUT' &&
      response.url().includes('/version/prompt_lib/') &&
      response.status() < 400,
    { timeout: 30_000 },
  );
  await page.getByTestId('pipeline-save-button').click();
  await persisted;
  // A failed save renders a role="alert" banner (EditPipeline.tsx); no toast
  // infrastructure exists.
  await expect(page.getByText('Failed to save your changes.')).toHaveCount(0);
}

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

  // Edit the graph: add an LLM node through the editor's own menu. (Was an
  // Agent node; an Agent's `tool` participant alias is seeded empty on
  // purpose — see SAVEABLE_NODE_LABELS — so the editor refuses to save one
  // until it is picked, and this journey is about the save/reload round trip,
  // not about that refusal.)
  await addNodeThroughMenu(page, 'LLM');
  await saveAndAwaitPersist(page);

  /*
   * The node id asserted on below is read back from the BACKEND, not typed
   * in here. The previous version of this test hardcoded
   * `.react-flow__node[data-id="Agent 1"]` — a screen echo: the canvas shows
   * whatever the editor's own store holds, so the assertion passed for as
   * long as the editor minted `"Agent 1"`, an id the pipeline compiler
   * refuses outright (`valid_graph_id`, worker `graph/yaml.rs:362`). Every
   * pipeline authored in this editor was unloadable and this journey was
   * green the whole time.
   */
  const versionId = await resolveLatestPipelineVersionId(page.request, DEFAULT_PROJECT_ID, id);
  const stored = await readStoredPipelineVersion(page.request, DEFAULT_PROJECT_ID, id, versionId);
  const graph = parseStoredGraph(stored.instructions);
  const storedAddedId = storedNodeIds(graph).find(nodeId => nodeId.startsWith('LLM'));
  expect(storedAddedId, 'the added LLM node must reach the stored document').toBeTruthy();
  expect(storedAddedId).toMatch(COMPILER_LEGAL_NODE_ID);

  await page.goto(BASE_URL + `/app/pipelines/latest/${id}`);
  // The reload really did re-fetch this pipeline (backend-derived name).
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible({ timeout: 15_000 });

  // Acceptance (1): the saved pipeline reloads with the SAME graph — matched
  // against the id the backend stored, not one this file invented.
  await expect(page.locator(`.react-flow__node[data-id="${storedAddedId as string}"]`)).toBeVisible({
    timeout: 10_000,
  });
});

test('J16: the Add-node menu offers exactly the node types the pipeline compiler admits', async ({ page }) => {
  /*
   * `Code` and `Custom` had no `parse_pipeline_node` arm
   * (`services/elitea-worker-rust/src/agents/graph/compiler.rs:1236`), so a
   * pipeline containing either was refused whole with "the pipeline contains
   * a node type that is not enabled" (`compiler.rs:1267`). They are withheld
   * from AUTHORING only — their renderers stay registered so stored
   * documents holding one still display.
   */
  const name = `${AUTOTEST_PREFIX}menu-${Date.now() % 1e9}`;
  await createPipelineThroughUi(page, name);
  await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add node' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });

  for (const label of ADMITTED_NODE_LABELS) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'Code', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Custom', exact: true })).toHaveCount(0);
  // Nothing else either — the menu is exactly the compiler's allow-list.
  await expect(menu.getByRole('menuitem')).toHaveCount(ADMITTED_NODE_LABELS.length);
});

test('J16: every node type the menu offers mints a compiler-legal id', async ({ page }) => {
  /*
   * The measured defect. `getInitialNodeId` minted `` `${prefix} ${n}` `` —
   * "Agent 1", WITH A SPACE — and `valid_graph_id`
   * (`services/elitea-worker-rust/src/agents/graph/yaml.rs:362`) admits ASCII
   * alphanumerics plus `_ - . :` and nothing else. It is called on every
   * node's raw `id` (`application.rs:119`, `decision.rs:80`,
   * `direct_tool.rs:154`, `hitl.rs:150`, `router.rs:165`) and on
   * `entry_point` (`compiler.rs:464`) — and the editor sets `entry_point` to
   * the FIRST node added. So the first node a user added produced a document
   * the compiler refuses (`graph.pipeline.invalid_configuration`). The Python
   * SDK worker hid this by silently rewriting ids through `clean_string`; the
   * Rust worker never rewrites.
   *
   * This covers all nine admitted types. The three that cannot be SAVED
   * unconfigured (see SAVEABLE_NODE_LABELS) are only reachable here; the
   * stored-document gate is the test after this one.
   */
  test.slow();
  const name = `${AUTOTEST_PREFIX}mint-${Date.now() % 1e9}`;
  await createPipelineThroughUi(page, name);
  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible({ timeout: 15_000 });

  for (const label of ADMITTED_NODE_LABELS) {
    await addNodeThroughMenu(page, label);
  }

  const canvasIds = await page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-id') ?? ''),
  );
  // One node per menu item, plus the default END node.
  expect(canvasIds.length).toBeGreaterThanOrEqual(ADMITTED_NODE_LABELS.length);
  expect(canvasIds).not.toContain('Agent 1');
  for (const nodeId of canvasIds) {
    expect(nodeId, `minted node id "${nodeId}" is not addressable by the pipeline compiler`).toMatch(
      COMPILER_LEGAL_NODE_ID,
    );
  }
  // The Agent node specifically — the id in the defect report.
  expect(canvasIds).toContain('Agent_1');
});

test('J16: the STORED pipeline document carries only compiler-legal ids', async ({ page }) => {
  /*
   * The real gate. Everything above this line reads the canvas, which shows
   * whatever the editor's own store holds; only the persisted `instructions`
   * document is what the worker ever compiles. The previous version of this
   * journey asserted `.react-flow__node[data-id="Agent 1"]` and nothing else,
   * and stayed green for as long as the editor was minting an id no pipeline
   * could be built from.
   */
  test.slow();
  const name = `${AUTOTEST_PREFIX}ids-${Date.now() % 1e9}`;
  const id = await createPipelineThroughUi(page, name);
  await expect(page.locator('.react-flow__node[data-id="END"]')).toBeVisible({ timeout: 15_000 });

  for (const label of SAVEABLE_NODE_LABELS) {
    await addNodeThroughMenu(page, label);
  }
  await saveAndAwaitPersist(page);

  const versionId = await resolveLatestPipelineVersionId(page.request, DEFAULT_PROJECT_ID, id);
  const stored = await readStoredPipelineVersion(page.request, DEFAULT_PROJECT_ID, id, versionId);
  const graph = parseStoredGraph(stored.instructions);

  // One node per label actually reached the backend — otherwise every id
  // assertion below would be vacuously true of an empty list.
  const ids = storedNodeIds(graph);
  expect(ids.length).toBeGreaterThanOrEqual(SAVEABLE_NODE_LABELS.length);

  for (const nodeId of ids) {
    expect(nodeId, `stored node id "${nodeId}" is not addressable by the pipeline compiler`).toMatch(
      COMPILER_LEGAL_NODE_ID,
    );
  }

  // `entry_point` goes through the same `valid_graph_id` check
  // (`compiler.rs:464`) and is set to the first node added, so it is the very
  // first thing a space would break.
  expect(graph.entry_point, 'the stored graph must declare an entry point').toBeTruthy();
  expect(graph.entry_point as string).toMatch(COMPILER_LEGAL_NODE_ID);
  expect(ids).toContain(graph.entry_point as string);

  // The literal defect string, anywhere in the stored document — including
  // any transition, route target or Decision `nodes:` entry that a
  // space-separated id would have been written into.
  expect(
    stored.instructions.includes('Agent 1'),
    'the stored pipeline still contains the literal "Agent 1" — the compiler cannot address it',
  ).toBe(false);
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
