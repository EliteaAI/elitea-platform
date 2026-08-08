/**
 * Journey 19: create a credential → verify it persists → remove it (JRNY-019)
 *
 * Spec §8.5 acceptance (from parity/manifest/credentials.json JRNY-019).
 * Acceptance: the credential is persisted and selectable; removing it
 * invalidates dependent configuration gracefully.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY NO LONGER DOES
 *
 * The previous version had 13 escape hatches (a `test.skip`, three early
 * `return`s, five `.catch(() => false)` swallows and four `.or()` fallbacks)
 * and asserted nothing that a heading-only stub could not satisfy. The
 * decisive one was `getByTestId('config-form').or(getByRole('dialog'))
 * .or(getByRole('main'))` — `role=main` is rendered by the app shell on
 * EVERY route, so that locator matched unconditionally. Every hatch is gone;
 * nothing below is optional.
 *
 * PRODUCT GAP (do not re-add): the "…and use it in an agent" half of
 * JRNY-019 is unassertable because no credential picker is reachable in the
 * running app. `src/features/credentials/ui/CredentialsSelect.tsx` is the
 * only component that renders one, and it has no production caller — its
 * two slot consumers (`AgentEditor`'s optional `renderLlmModelSelector` and
 * `PipelineEditorParts`) are never handed a renderer by any route or page.
 * The testids the old test used for that half —`llm-selector`, `config-form`,
 * `create-application-form-panel` — do not exist in `src` at all; the first
 * two are vitest mocks in `AgentEditor.test.tsx`, the third is a doc-comment
 * string in `CreateApplication.tsx`. That half is therefore deleted rather
 * than left behind a `test.skip()` that reads as coverage.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX } from '../../fixtures/api';

/**
 * The entry point into the credential-creation flow.
 *
 * This is a genuine round-trip landmark, not a paint check: `AddModelButton`
 * renders only inside `ConfigurationsPanel`, which `AIConfiguration.tsx:117`
 * mounts only once `configurationsBySection` is non-null — and
 * `useConfigurationsBySection.ts:76` returns null while ANY of its seven
 * per-section queries is still fetching. A stubbed or heading-only
 * `/settings/model-configuration` cannot produce it.
 */
test('J19a: the AI-Configuration screen offers credential creation and routes to the create flow', async ({ page }) => {
  await page.goto(BASE_URL + '/app/settings/model-configuration');

  const createButton = page.getByRole('button', { name: 'Create configuration', exact: true });
  await expect(createButton).toBeEnabled({ timeout: 30_000 });

  await checkA11y(page);

  await createButton.click();

  // AddModelButton.tsx:19-21 navigates with `search: { from: 'model-configuration' }`.
  // Asserting the search param (not just the path) pins the actual call, so a
  // plain <Link to="/settings/create-configuration"> would not satisfy it.
  await expect(page).toHaveURL(/\/settings\/create-configuration\?.*\bfrom=model-configuration\b/);
});

/**
 * The full lifecycle: pick a type from the server catalog → fill the
 * schema-driven form → POST → see the row → re-open it with server-seeded
 * values → delete it and see it gone.
 *
 * ⚠ THIS TEST FAILS TODAY, AND THAT FAILURE IS THE POINT. Four real defects
 * make the journey impossible to complete in the E2E stack; none of them is
 * worked around here, because working around them is exactly what made the
 * old version of this file green while testing nothing.
 *
 * Every locator below was validated against the running stack by replaying
 * this body with GET /configurations/available/ fulfilled from the pinned
 * catalog snapshot (i.e. simulating ELITEA_CONFIGURATIONS_ENABLED=true).
 * With that one substitution every step passes — tiles, search filter, type
 * URL, schema fields, save gate, POST 201, edit-form seeding, the delete
 * dropdown, the type-to-confirm modal and the DELETE round trip — EXCEPT the
 * "row appears in the list" step, which fails on defect 4.
 *
 *  1. GET /configurations/available/ serves the WRONG payload. The mounted
 *     route is the prototype `configurations.Handler.Available`
 *     (services/elitea-main/internal/api/v2/configurations/handler.go:108,
 *     mounted at internal/api/router.go:574) which returns 9 hardcoded rows
 *     of shape {type, display_name, section} and NO `config_schema`. The
 *     snapshot-backed route that does carry `config_schema`
 *     (current_available_route.go, 49 entries) is composed in main.go:371
 *     only when ELITEA_CONFIGURATIONS_ENABLED=true, and that variable is set
 *     in no compose file, deploy manifest or e2e-stack.sh.
 *  2. Consequently `CredentialTypeSelector.tsx:33-38` dereferences
 *     `item.config_schema.metadata` / `.properties` on entries that have no
 *     `config_schema`, throwing "Cannot read properties of undefined
 *     (reading 'metadata')". The whole /settings/create-configuration route
 *     renders the error boundary ("Something went wrong."). Note this is an
 *     UNGUARDED deref of a field the wire type marks as required — the client
 *     crashes rather than degrading, which is a defect in its own right.
 *  3. POST /configurations/configurations/{projectId} writes the
 *     `elitea_title` column from the request body's `name` key
 *     (handler.go:451 `strVal(body, "name")`), but the client — and the
 *     documented contract — send `elitea_title`. Every created row therefore
 *     lands with elitea_title = '' , and because that column is UNIQUE the
 *     SECOND configuration created in a project fails with 500
 *     {"error":"create failed"}. Verified directly against the running stack.
 *     Related: GET/DELETE /configurations/configuration/{project}/{id} match
 *     on the numeric id only and 404 on the `uuid` the POST response returns.
 *  4. The same handler writes the `section` column from body["section"]
 *     (handler.go:453), which the client never sends — `performSave` posts
 *     {elitea_title, label, data, shared, type} only. Rows therefore land with
 *     section = '' and belong to NONE of the seven sections
 *     `useConfigurationsBySection.ts:15-23` queries, so a credential created
 *     through the UI is INVISIBLE in the UI forever. The backend should derive
 *     `section` from the catalog entry for `type` (open_ai → ai_credentials).
 *     This is the direct failure of JRNY-019's "is persisted and selectable".
 *
 * Do NOT make this test pass by softening it. It goes green when the catalog
 * route is enabled and the create handler reads `elitea_title` and derives
 * `section`.
 */
test('J19b: create a credential, verify it persisted, then delete it', async ({ page }) => {
  // Expected-fail on #131. Four stacked defects: the prototype /configurations/available/
  // route is mounted instead of the 49-entry snapshot route (ELITEA_CONFIGURATIONS_ENABLED
  // is set nowhere), CredentialTypeSelector then crashes on the schema-less payload,
  // create writes elitea_title from the wrong body key so the SECOND config in a
  // project 500s forever on a UNIQUE column, and section is written empty so saved
  // rows appear in none of the 7 queried sections.
  //
  // Not a guess: replaying the catalogue from the pinned snapshot made this entire
  // journey pass — POST 201, edit-form seeding, DELETE 204 — with only the list-row
  // step still red. The spec is right; the product is not.
  //
  // test.fail() rather than test.skip(): a skip runs nothing and reports green. This
  // runs every assertion and turns CI red the moment #131 is fixed.
  test.fail();
  // `elitea_title` carries a UNIQUE index (scripts/e2e-stack.sh:252) and the
  // create path submits the typed name as both `label` and `elitea_title`
  // (useCredentialFormController.ts buildTitle), so the name must be unique
  // per run AND per concurrently-running spec file.
  const unique = `${AUTOTEST_PREFIX}cred_lifecycle_${Date.now()}`;

  await page.goto(BASE_URL + '/app/settings/model-configuration');

  const createButton = page.getByRole('button', { name: 'Create configuration', exact: true });
  await expect(createButton).toBeEnabled({ timeout: 30_000 });

  // Pre-state: the row must be absent now, so its later appearance proves a
  // round trip rather than a pre-seeded fixture.
  await expect(page.getByText(unique)).toHaveCount(0);

  await createButton.click();
  await expect(page).toHaveURL(/\/settings\/create-configuration\?.*\bfrom=model-configuration\b/);

  // ── The type picker is built from GET /configurations/available/ ─────────
  // These labels come from the catalog's `config_schema.title`
  // (CredentialTypeSelector.tsx:33-35). A static route body cannot produce
  // them, and — see defect 1/2 above — neither can the currently mounted
  // backend route.
  const openAiTile = page.getByRole('button', { name: 'OpenAI', exact: true });
  await expect(openAiTile).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Azure OpenAI', exact: true })).toBeVisible();

  // Filtering the fetched list proves the tiles are data, not markup.
  const search = page.getByPlaceholder('Search credentials');
  await search.fill('Vertex');
  await expect(page.getByRole('button', { name: 'Vertex AI', exact: true })).toBeVisible();
  await expect(openAiTile).toHaveCount(0);
  await search.fill('');
  await expect(openAiTile).toBeVisible();

  await checkA11y(page);

  await openAiTile.click();
  await expect(page).toHaveURL(/\/settings\/create-configuration\/open_ai/);

  // ── The form is schema-driven ────────────────────────────────────────────
  // "Api Base"/"Api Key" are `title`s taken from the open_ai JSON schema
  // (CredentialFormFields.tsx metaFor), and "Test connection" renders only
  // when the FETCHED descriptor carries has_test_connection
  // (CredentialForm.tsx:131) — none of the three is reachable without the
  // catalog response.
  const nameInput = page.getByRole('textbox', { name: 'Name' });
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  const apiBase = page.getByRole('textbox', { name: 'Api Base' });
  await expect(apiBase).toBeVisible();
  await expect(page.getByLabel('Api Key')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible();

  await checkA11y(page);

  // ── The save gate is real ────────────────────────────────────────────────
  // canSubmit() needs the seeded `configurations.configuration.update`
  // permission AND a non-blank name (useCredentialFormController.ts:148).
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await nameInput.fill(unique);
  await apiBase.fill('http://localhost/mock');
  await expect(save).toBeEnabled();

  // ── Server round trip, with the assigned id ──────────────────────────────
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/configurations/configurations/'),
      { timeout: 20_000 },
    ),
    save.click(),
  ]);
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { id?: string | number; uuid?: string };
  // The detail/delete routes match on the numeric id, not the uuid (defect 3).
  const configId = String(created.id ?? '');
  expect(configId).not.toBe('');

  // performSave only calls onSaved() — and the route only navigates back —
  // on the success branch, so this URL is itself a mutation assertion.
  await expect(page).toHaveURL(/\/settings\/model-configuration(\?|$)/, { timeout: 15_000 });

  // A section renders only when non-empty (ConfigurationSection.tsx:188), so
  // this row exists only because the POST landed and the list refetched.
  await expect(page.getByText(unique, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // ── Values seeded from the server ────────────────────────────────────────
  // useFormSeeding fills these from GET /configurations/configuration/{project}/{id}.
  // The edit screen is reached by deep link because clicking the card goes to
  // /settings/create-configuration and buries the id in a breadcrumb string
  // (useConfigurationNavigation.ts:21-42) — a separate product defect, not
  // something to assert around.
  await page.goto(`${BASE_URL}/app/settings/edit-configuration/${configId}`);
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(unique, { timeout: 20_000 });
  await expect(page.getByRole('textbox', { name: 'Api Base' })).toHaveValue('http://localhost/mock');

  await checkA11y(page);

  // ── Removal (the second half of JRNY-019's acceptance) ───────────────────
  // Delete exists in edit mode only (CredentialForm.tsx:140), which is why it
  // runs from the edit route rather than the create one.
  await page.getByRole('button', { name: 'Credential actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  // DeleteEntityModal's type-to-confirm: Confirm stays disabled until the
  // typed value matches the entity name exactly (isConfirmDisabled).
  const confirm = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await page.locator('#delete-entity-modal-input-name').fill(unique);
  await expect(confirm).toBeEnabled();

  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'DELETE' && r.url().includes('/configurations/configuration/'),
      { timeout: 20_000 },
    ),
    confirm.click(),
  ]);
  expect(deleteResponse.ok()).toBe(true);

  // Back on the list, refetched from the server — the row is gone for real,
  // not merely dropped from local state.
  await expect(page).toHaveURL(/\/settings\/model-configuration(\?|$)/, { timeout: 15_000 });
  await expect(createButton).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText(unique)).toHaveCount(0);
});
