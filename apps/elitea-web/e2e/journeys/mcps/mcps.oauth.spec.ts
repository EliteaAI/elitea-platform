/**
 * Journey 18: Create MCP → OAuth callback round trip (JRNY-018)
 *
 * Spec §8.5 acceptance (from parity/manifest/mcps.json JRNY-018):
 * the OAuth result reaches the app and the MCP becomes usable; OAuth errors
 * are shown on the callback screen.
 *
 * ── Rewrite notes (escape-hatch removal) ────────────────────────────────
 * The previous version of this file could not fail. It navigated to
 * `/app/mcp/my` (NOT a route — the real list is `/app/mcps/$tab`), then
 * asserted `getByText(/error|failed|invalid|callback|auth/i)`, which the
 * SUCCESS copy "Authorization successful! Closing window..." satisfies just
 * as happily as a stub page containing the word "auth"; then took one of two
 * `.catch(() => false)` early returns before any create assertion ran.
 *
 * Every assertion below now targets something a stub cannot produce:
 *  - the three mutually exclusive callback states by their EXACT copy, with
 *    the other two asserted absent;
 *  - the relay payload the page writes to `localStorage` under
 *    `el.mcp-auth-result-<state>` — the actual product behaviour of this
 *    page (it relays, it does not exchange tokens: see
 *    `src/pages/mcps/McpAuthCallbackPage.tsx:1-35`);
 *  - the MCP list row count reconciled against the live
 *    `GET /elitea_core/tools/prompt_lib/{projectId}` response;
 *  - the MCP type catalogue reconciled against the live
 *    `GET /elitea_core/toolkits/prompt_lib/{projectId}` response.
 *
 * ── Known app defects this file now surfaces instead of hiding ──────────
 * D1 — FIXED (#129), re-measured 2026-08-09 against the standalone e2e
 *    stack. It used to read: `POST /elitea_core/tools/prompt_lib/{projectId}`
 *    ALWAYS returns 500, because `pgRepo.CreateToolkit` never INSERTed the
 *    NOT-NULL `owner_id`, so no toolkit or MCP could be created at all. That
 *    is no longer true: the POST returns 201 with the minted row, the row
 *    comes back from `GET /elitea_core/tools/prompt_lib/{projectId}`, and
 *    `GET /elitea_core/tool/prompt_lib/{projectId}/{id}` serves its detail.
 *    The seed test below now gets all the way to the Indexes tab (see D3).
 * D2 — FIXED, same measurement. It used to read: `GET /elitea_core/toolkits/
 *    prompt_lib/{projectID}` is routed to the *instance* list and answers
 *    `{"rows":[],"total":0}`, so the type→schema map the create page needs
 *    was unreachable and no MCP type could ever be offered. That endpoint now
 *    returns the real type→schema map (`application`, `artifact`, … each with
 *    their `properties`/`args_schemas`). The catalogue test below was written
 *    against the backend-DERIVED set rather than against "empty", so it kept
 *    its teeth across the fix instead of cementing the bug — which is the
 *    only reason this correction was cheap to make.
 * D3 (frontend, the one still standing — #149): `pages/toolkits/
 *    EditToolkit.tsx:313-314` renders the Indexes tab as
 *    `{tab === 1 && <Box data-testid="edit-toolkit-indexes-tab-panel" />}` —
 *    a real, clickable tab label in front of an empty Box.
 *    `features/toolkits/indexes/ui/IndexesContainer.tsx` is fully ported
 *    (list, selection, delete-confirm, notification-link alert) and has ZERO
 *    production importers. Same shape as #134/#126/#129.
 *
 * ── Genuinely untestable here ──────────────────────────────────────────
 * The end-to-end "MCP becomes usable after authorization" half of JRNY-018
 * still cannot be exercised — but NOT for the reason recorded here before.
 * The old reason ("no MCP toolkit can exist while D1 stands") died with D1.
 * The real one, re-grepped: the receiving end of the relay is
 * `features/mcps`' `McpAuthModal`/`useMcpAuthModal`, and neither has any
 * production call site — every hit outside `features/mcps/ui/McpAuthModal.*`
 * is a doc comment citing it as a known gap (`ToolActionsSelector.tsx:28-33`,
 * `ToolBase.tsx:123`, `TestTools.tsx:48-54`). `OAuthFormFields.tsx` is
 * reachable only from that unmounted modal. So there is no OAuth-configuring
 * form to drive. Stated here and in the run report rather than hidden behind
 * a `test.skip()`.
 */
import { expect, test } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { API_BASE, AUTOTEST_PREFIX, DEFAULT_PROJECT_ID } from '../../fixtures/api';

/** Exact copy from src/shared/i18n/en.json:1081-1084 — the page's three mutually exclusive states. */
const COPY = {
  processing: 'Processing authorization...',
  success: 'Authorization successful! Closing window...',
  failed: 'Authorization failed',
  invalidResponse: 'Invalid authorization response',
} as const;

/** `shared/lib/storage.ts`'s `STORAGE_NAMESPACE` + `McpAuthCallbackPage`'s `crossTabKey`. */
function relayKey(state: string): string {
  return `el.mcp-auth-result-${state}`;
}

/**
 * Reads the relay payload the callback page wrote for `state`.
 * The page removes the key 5 s after writing it, so callers must read
 * promptly — a `null` here means the page never relayed, not that it expired.
 */
async function readRelay(page: import('@playwright/test').Page, state: string): Promise<unknown> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), relayKey(state));
  return raw === null ? null : JSON.parse(raw);
}

test.describe('JRNY-018 — MCP OAuth callback round trip', () => {
  test('J18: callback with an authorization code renders success AND relays the code', async ({ page }) => {
    const state = 'e2e-j18-success-mcp';
    const code = 'e2e-authcode-mcp';

    await page.goto(`${BASE_URL}/app/mcp-auth-callback?code=${code}&state=${state}`, {
      waitUntil: 'domcontentloaded',
    });

    // Exact success copy — not a regex that the processing/error copy also matches.
    await expect(page.getByText(COPY.success, { exact: true })).toBeVisible({ timeout: 10_000 });
    // The other two states must be absent; asserting only the positive lets a
    // page that renders all three (or a stub echoing the query string) pass.
    await expect(page.getByText(COPY.processing, { exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY.failed, { exact: true })).toHaveCount(0);

    // The page's actual product behaviour: relay the result to the opener.
    // A heading-only stub cannot produce this payload.
    expect(await readRelay(page, state)).toEqual({
      type: 'mcp-auth-result',
      state,
      success: true,
      code,
    });

    await checkA11y(page);
  });

  test('J18: callback with an OAuth error renders the failure AND relays the error', async ({ page }) => {
    const state = 'e2e-j18-error-mcp';
    const errorCode = 'access_denied';
    const description = 'The MCP server owner denied the request';

    await page.goto(
      `${BASE_URL}/app/mcp-auth-callback?error=${errorCode}&error_description=${encodeURIComponent(description)}&state=${state}`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect(page.getByText(COPY.failed, { exact: true })).toBeVisible({ timeout: 10_000 });
    // The provider's own description must be surfaced verbatim — this is the
    // "OAuth errors are shown on the callback screen" half of the acceptance.
    await expect(page.getByText(description, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.success, { exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY.processing, { exact: true })).toHaveCount(0);

    expect(await readRelay(page, state)).toEqual({
      type: 'mcp-auth-result',
      state,
      error: errorCode,
      error_description: description,
    });

    await checkA11y(page);
  });

  test('J18: callback with neither code nor error is rejected as an invalid response', async ({ page }) => {
    const state = 'e2e-j18-invalid-mcp';

    await page.goto(`${BASE_URL}/app/mcp-auth-callback?state=${state}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(COPY.failed, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(COPY.invalidResponse, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.success, { exact: true })).toHaveCount(0);

    // `invalid_request` is synthesised by the page itself (line 159) — it is in
    // no query parameter, so an echo-the-URL stub cannot produce it.
    expect(await readRelay(page, state)).toEqual({
      type: 'mcp-auth-result',
      state,
      error: 'invalid_request',
      error_description: 'Missing authorization code',
    });

    await checkA11y(page);
  });

  test('J18: the MCP list renders exactly the MCP-typed toolkits the API returns', async ({ page }) => {
    // Backend-derived expectation, fetched over the SAME authenticated context
    // the app uses. `isMcpToolkit` (src/entities/toolkit/model/selectors.ts:30-33).
    const resp = await page.request.get(
      `${API_BASE}/elitea_core/tools/prompt_lib/${DEFAULT_PROJECT_ID}?limit=100&offset=0`,
    );
    expect(resp.status(), 'GET /elitea_core/tools/prompt_lib is the MCP list feed').toBe(200);
    const body = (await resp.json()) as { rows?: readonly { name: string; type: string; meta?: { mcp?: boolean } }[] };
    const expectedMcpNames = (body.rows ?? [])
      .filter((row) => row.type === 'mcp' || row.type.startsWith('mcp_') || row.meta?.mcp === true)
      .map((row) => row.name)
      .sort();

    await page.goto(`${BASE_URL}/app/mcps/all`, { waitUntil: 'domcontentloaded' });

    // The MCP branch of the list panel testid (Toolkits.tsx:360) — the
    // toolkits branch renders `toolkits-list-panel`, so this also proves the
    // page was mounted with `isMCP`.
    await expect(page.getByTestId('mcps-list-panel')).toBeVisible({ timeout: 15_000 });

    const cards = page.getByTestId('toolkit-card');
    await expect(cards).toHaveCount(expectedMcpNames.length, { timeout: 15_000 });
    expect((await cards.allInnerTexts()).map((textOfCard) => textOfCard.split('\n')[0]).sort()).toEqual(
      expectedMcpNames,
    );

    await checkA11y(page);
  });

  test('J18: the MCP create page offers exactly the MCP types the catalogue endpoint returns', async ({ page }) => {
    // D2 is fixed (see the module comment): this endpoint now returns the real
    // type→schema map, not the instance envelope, so `mcpTypeKeys` below is
    // derived from live schemas rather than from an empty list. Because the
    // assertion was always written against the derived set — never against
    // "empty" — it survived the backend fix without editing, and now asserts
    // the real catalogue. Whichever side is empty, the two must agree.
    const resp = await page.request.get(`${API_BASE}/elitea_core/toolkits/prompt_lib/${DEFAULT_PROJECT_ID}`);
    expect(resp.status(), 'GET /elitea_core/toolkits/prompt_lib feeds the MCP type selector').toBe(200);
    const schemas = (await resp.json()) as Record<string, { type?: string } | undefined>;
    // `isMcpFlavouredKey` (src/features/toolkits/lib/hooks/useGetCurrentMCPSchemas.hooks.ts:53-55).
    const mcpTypeKeys = Object.entries(schemas)
      .filter(([key, value]) => key.toLowerCase() === 'mcp' || value?.type === 'mcp' || key.toLowerCase().endsWith('mcp'))
      .map(([key]) => key);

    await page.goto(`${BASE_URL}/app/mcps/create`, { waitUntil: 'domcontentloaded' });

    // Two controls a stub page cannot fake: the MCP-specific selector title and
    // the MCP-specific search field (accessible name from the placeholder,
    // ToolkitTypeSelector.tsx:170 → CategoryFilter.tsx:67). Their presence also
    // proves `useIsMcpVisible()` resolved true — the selector returns null
    // outright when `mcp_enabled === false` (ToolkitTypeSelector.tsx:238).
    await expect(page.getByText('Choose the MCP type', { exact: true })).toBeVisible({ timeout: 15_000 });
    const search = page.getByRole('textbox', { name: 'Search MCPs' });
    await expect(search).toBeVisible();
    await expect(search).toBeEditable();

    // The catalogue must match the backend exactly, in BOTH directions: every
    // returned type is offered, and the documented empty state appears if and
    // only if the backend offered nothing.
    const emptyState = page.getByText('Still no local MCP available. Follow creation guides in our', { exact: false });
    await expect(emptyState).toHaveCount(mcpTypeKeys.length === 0 ? 1 : 0);
    for (const key of mcpTypeKeys) {
      await expect(page.getByRole('button', { name: key === 'mcp' ? 'Remote MCP' : key })).toBeVisible();
    }

    await checkA11y(page);
  });

  test('J18: an MCP created through the API is listed and opens on its own detail screen', async ({ page }) => {
    /*
     * STILL EXPECTED-FAIL, but for a different defect than the one recorded
     * here until 2026-08-09 — and this is exactly the failure mode a stale
     * `test.fail()` produces, so the correction is written out in full.
     *
     * OLD reason (D1/#129): the seed 500'd because `owner_id` was never
     * INSERTed, so no MCP could be created and every assertion after the seed
     * was unreachable. Re-measured on the standalone stack: the POST returns
     * 201, and the list/detail round trip works.
     *
     * MEASURED reason today (D3/#149): the seed, the list card, the
     * backend-minted id in the URL, the detail name and the test-pane slot all
     * PASS. It fails on the last assertion — the Indexes tab panel is an empty
     * `<Box/>` (`EditToolkit.tsx:313-314`) because `IndexesContainer` has no
     * production importer, so it resolves to a zero-box element and is never
     * visible. Verified by removing this annotation and reading the failure:
     *
     *   14 × locator resolved to
     *   <div class="MuiBox-root css-0" data-testid="edit-toolkit-indexes-tab-panel"></div>
     *
     * The annotation stays because the test genuinely still fails; only the
     * cause moved. `test.fail()` rather than `test.skip()`: this runs every
     * assertion and turns the suite RED the moment #149 lands.
     *
     * Coverage claim, narrowed accordingly: everything up to and including the
     * detail screen IS now executed and proven. Only the Indexes-tab assertion
     * and the `checkA11y` after it are unreached.
     */
    test.fail();
    const name = `${AUTOTEST_PREFIX}j18-oauth-mcp`;
    const createResp = await page.request.post(
      `${API_BASE}/elitea_core/tools/prompt_lib/${DEFAULT_PROJECT_ID}`,
      { data: { name, type: 'mcp', description: 'JRNY-018 OAuth round trip fixture' } },
    );
    expect(
      createResp.status(),
      `POST /elitea_core/tools/prompt_lib must create an MCP; got ${createResp.status()} ${(await createResp.text()).slice(0, 300)}`,
    ).toBe(201);
    const created = (await createResp.json()) as { id: string };

    try {
      await page.goto(`${BASE_URL}/app/mcps/all`, { waitUntil: 'domcontentloaded' });

      const card = page.getByTestId('toolkit-card').filter({ hasText: name });
      await expect(card).toHaveCount(1, { timeout: 15_000 });

      await card.click();

      // The URL must carry the id the BACKEND minted, not a placeholder.
      await expect(page).toHaveURL(new RegExp(`/app/mcps/all/${created.id}(\\?|$)`), { timeout: 15_000 });

      // EditToolkit titles itself from the fetched detail (`detail?.name ??
      // 'Edit MCP'`, EditToolkit.tsx:250-251), so the seeded name appearing
      // here proves GET /tool/prompt_lib/{project}/{id} round-tripped.
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Edit MCP', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('edit-toolkit-test-pane-slot')).toBeVisible();

      await page.getByRole('tab', { name: 'Indexes' }).click();
      await expect(page.getByTestId('edit-toolkit-indexes-tab-panel')).toBeVisible();

      await checkA11y(page);
    } finally {
      await page.request.delete(
        `${API_BASE}/elitea_core/tool/prompt_lib/${DEFAULT_PROJECT_ID}/${created.id}`,
      );
    }
  });
});
