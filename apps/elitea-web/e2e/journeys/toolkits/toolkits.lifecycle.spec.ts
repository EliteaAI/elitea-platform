/**
 * Journey 17: Create toolkit → configure → test connection (JRNY-017)
 *
 * Spec §8.5 acceptance (from parity/manifest/toolkits.json JRNY-017).
 * Acceptance: the test result is displayed; the saved toolkit appears in the list.
 *
 * ── NOT COVERED (product gaps — deliberately NOT asserted around) ───────────
 *
 * 1. "Test connection" — NO UI EXISTS. `onTestConnection` is only a prop TYPE
 *    (features/toolkits/ui/form/ToolkitForm/ToolkitsOperationButtons.types.ts:69);
 *    ToolkitsOperationButtons never destructures or renders it. The toolkit
 *    test endpoints (/test_tool, /test_toolkit_tool) exist in
 *    services/elitea-main/internal/api/router.go but are absent from
 *    api/openapi/v2.yaml, so no generated client method reaches them.
 *    The live test PANE is a declared composition gap: EditToolkit.tsx:299-310
 *    renders an EMPTY <Box data-testid="edit-toolkit-test-pane-slot" />.
 *    => The "the test result is displayed" half of JRNY-017 cannot be written
 *       as a real assertion today. It is NOT stubbed here and NOT skipped —
 *       it is simply absent, and this note is the coverage record.
 *
 * 2. Edit-and-save on the detail page — no save affordance is mounted.
 *    ToolkitsOperationButtons draws no persistent button; its update path
 *    fires only on eventEmitter ToolEvents.ToolkitsUpdateToolkit, and the only
 *    emitter (ToolkitsTabBar) has no caller. Needs its own journey once wired.
 *
 * ── KNOWN-FAILING (real defects this journey now surfaces instead of hiding) ─
 *
 * A. GET /elitea_core/toolkits/prompt_lib/{projectID} is routed to
 *    toolkitHandler.List (the toolkit-INSTANCE list, {rows,total}) in BOTH
 *    branches of services/elitea-main/internal/api/router.go:645-670.
 *    toolkitHandler.ListTypeSchemas — the handler that actually returns the
 *    type→JSON-schema MAP the generated `listToolkits` client and
 *    useGetCurrentToolkitSchemas expect — is never routed anywhere.
 *    Consequence: ToolkitTypeSelector iterates the pagination envelope and
 *    renders two label-less tiles ("rows"/"total"), plus the client-injected
 *    "Custom". No real toolkit type is selectable. => test 2 fails.
 *
 * B. POST /elitea_core/tools/prompt_lib/{projectID} always 500s:
 *    pgRepo.CreateToolkit (toolkits/handler.go:891-920) inserts
 *    (name,type,description,settings,meta,author_id) but NOT owner_id, which
 *    is `owner_id INTEGER NOT NULL` with no default
 *    (infra/db/migrations/001_initial.sql:181). Server response:
 *    `null value in column "owner_id" of relation "elitea_tools" violates
 *    not-null constraint (SQLSTATE 23502)`. ForkToolkit (line 799) does supply
 *    owner_id — Create is the outlier. => test 3 fails at the 201 assertion.
 *
 * Per the rewrite rules these are reported as findings, not weakened away.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX, API_BASE, DEFAULT_PROJECT_ID, clickCreateButton } from '../../fixtures/api';

/** Unique to THIS file so concurrent journeys never collide on a name. */
const toolkitName = (): string => `${AUTOTEST_PREFIX}tk${Date.now()}`;

/** Ids created by this file, deleted in afterAll. Never a blanket `autotest_` sweep — other specs run concurrently. */
const createdIds: string[] = [];

test.afterAll(async ({ browser }) => {
  if (createdIds.length === 0) return;
  const ctx = await browser.newContext();
  for (const id of createdIds) {
    await ctx.request.delete(`${API_BASE}/elitea_core/tool/prompt_lib/${DEFAULT_PROJECT_ID}/${id}`);
  }
  await ctx.close();
});

/**
 * The create page's own discriminating landmark: ToolkitTypeSelector's
 * CategoryFilter search box. A stub route with a bare heading has no form
 * control; the placeholder text comes from
 * toolkits.toolkitTypeSelector.searchToolkit.
 */
function typeSearchBox(page: Page) {
  return page.getByPlaceholder('Search toolkits');
}

test('J17.1: an empty toolkit list redirects to the create page', async ({ page }) => {
  // Behaviour under test: Toolkits.tsx's shouldRedirectToCreatePage gate
  // (pages/toolkits/Toolkits.tsx:57-67) driven by the REAL list response
  // (GET /elitea_core/tools/prompt_lib/{id} -> total 0). A stub page cannot
  // redirect, because the redirect is a function of server data.
  const listResponse = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/elitea_core\/tools\/prompt_lib\//.test(r.url()),
    { timeout: 20_000 },
  );
  await page.goto(BASE_URL + '/app/toolkits/all');

  const resp = await listResponse;
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as { rows: unknown[]; total: number };
  expect(body.total).toBe(0);

  await page.waitForURL(/\/app\/toolkits\/create/, { timeout: 20_000 });
  // The create screen really mounted — a form control, not a heading.
  await expect(typeSearchBox(page)).toBeVisible({ timeout: 15_000 });

  // NOTE: this currently fails on defect A's fallout — the two nameless ghost
  // tiles trip axe's `button-name` rule. The redirect assertions above pass.
  await checkA11y(page);
});

test('J17.2: the create page offers real, server-supplied toolkit types', async ({ page }) => {
  // PASSES as of the #129 route fix. The tile label "GitHub" is derivable ONLY
  // from a schema map that actually contains the key `github`
  // (entities/toolkit/model/toolMenu.ts labels each map key through ToolTypes),
  // so this cannot be satisfied by a stub or by the pagination envelope the
  // endpoint used to return.
  await page.goto(BASE_URL + '/app/toolkits/create');
  await expect(typeSearchBox(page)).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole('button', { name: 'GitHub', exact: true })).toBeVisible({ timeout: 15_000 });

  // checkA11y earns its place here and has now caught TWO different causes of the
  // same critical `button-name` violation, which is why it stays unconditional:
  //   1. before #129, the page iterated the {rows,total} pagination envelope and
  //      rendered a nameless tile per envelope KEY;
  //   2. after #129 served real types, `database` and `datasource` had no entry
  //      in the frontend ToolTypes map and the label fell back to '' — still two
  //      nameless tiles, entirely different cause.
  // Fixed by making the label fall back to a humanised key, so a backend type the
  // frontend has never heard of degrades to a readable name instead of nothing.
  //
  // (A dedicated nameless-button count was tried and REMOVED as vacuous:
  // Playwright's getByRole(..., {name: ''}) does not match empty accessible
  // names, so it asserted nothing.)
  await checkA11y(page);
});

test('J17.3: create a toolkit, persist it, and reopen it from the list', async ({ page }) => {
  // Expected-fail, but NOT for the reason first recorded here. The original
  // annotation blamed the #129 owner_id 500 on POST .../tools/prompt_lib/{id}.
  // That is fixed and verified (POST now returns 201), and this test consequently
  // gets much further: the type selector is replaced by the real form and Save is
  // enabled.
  //
  // It now fails one assertion later, at line ~150 — the CodeMirror document does
  // not contain `"type": "custom"` after picking the Custom type. Whether that is
  // a changed serialisation (spacing), CodeMirror virtualising the text out of the
  // DOM, or the type genuinely not being written into the draft is NOT yet
  // established, so no issue is cited: recording a cause I have not measured is
  // exactly the failure mode this suite exists to remove.
  //
  // See #129 for the create-path history.
  test.fail();
  const name = toolkitName();

  await page.goto(BASE_URL + '/app/toolkits/all');
  await page.waitForURL(/\/app\/toolkits\/(all|create)/, { timeout: 20_000 });
  if (!/\/create/.test(page.url())) await clickCreateButton(page);
  await page.waitForURL(/\/app\/toolkits\/create/, { timeout: 20_000 });
  await expect(typeSearchBox(page)).toBeVisible({ timeout: 15_000 });

  // Pick the `custom` type. It is a genuine type in the server's own
  // knownToolkitTypes list (GET /elitea_core/toolkit_types/prompt_lib/{id}),
  // and — until defect A is fixed — the only selectable one.
  await page.getByRole('button', { name: 'Custom', exact: true }).click();

  // The selector was REPLACED by the real form: ToolCustom's CodeMirror JSON
  // editor plus CreateToolkitToolTabBar's Save. Neither exists on a stub, and
  // the editor is seeded from the picked type's own initial values.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 15_000 });
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('"type": "custom"', { timeout: 15_000 });

  // Rename inside the JSON document (double-click selects the word, typing
  // replaces it — no bracket/quote typing, so CodeMirror auto-close cannot
  // corrupt the document).
  await page.getByText('"Custom tool"').first().dblclick();
  await page.keyboard.type(name);
  await expect(editor).toContainText(name);

  const [createResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/elitea_core\/tools\/prompt_lib\//.test(r.url()),
      { timeout: 20_000 },
    ),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  // KNOWN-FAILING here — defect B above: the server answers 500
  // (owner_id NOT NULL violation). Do not weaken this to `toBeLessThan(500)`.
  expect(createResp.status(), await createResp.text()).toBe(201);
  const created = (await createResp.json()) as { id: string };
  expect(created.id).toBeTruthy();
  createdIds.push(created.id);

  // CreateToolkit's only role=alert is "Failed to create the toolkit."
  await expect(page.getByRole('alert')).toHaveCount(0);

  await checkA11y(page);

  // ── Everything below is unreachable until defect B is fixed. It is NOT
  // guarded by an `if` and NOT skipped — it is plain sequential code that runs
  // the moment the 201 arrives. Each assertion below was nonetheless verified
  // to pass AND to fail correctly, by seeding one row straight into
  // p_1.elitea_tools (the insert CreateToolkit should be doing) and running
  // this exact locator sequence against it; the row was then deleted.
  //
  // ── Persistence: a FULL reload, so the 30 s-stale list cache cannot answer.
  await page.goto(BASE_URL + '/app/toolkits/all');
  const card = page
    .getByTestId('toolkits-list-panel')
    .getByTestId('toolkit-card')
    .filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 20_000 });

  await checkA11y(page);

  // ── Detail: opening the card must reach the id-bearing route and render
  // content fetched from GET /elitea_core/tool/prompt_lib/{id}/{toolkitId}.
  await card.click();
  // `(\?|$)` because the shell appends its own persisted query string.
  await expect(page).toHaveURL(new RegExp(`/app/toolkits/all/${created.id}(\\?|$)`), { timeout: 20_000 });
  // Route landmark unique to EditToolkit. toBeAttached, not toBeVisible — the
  // slot is an intentionally empty Box (composition gap 1 above).
  await expect(page.getByTestId('edit-toolkit-test-pane-slot')).toBeAttached({ timeout: 20_000 });
  // Backend-derived: the detail fetch populated the editor with the persisted
  // name. A stub route cannot produce this.
  await expect(page.locator('.cm-content').first()).toContainText(name, { timeout: 20_000 });

  await checkA11y(page);
});
