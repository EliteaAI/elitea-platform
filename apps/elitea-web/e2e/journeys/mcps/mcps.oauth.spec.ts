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
 * D1 (backend, blocks `J18: seed an MCP …`): `POST /elitea_core/tools/
 *    prompt_lib/{projectId}` ALWAYS returns 500. `pgRepo.CreateToolkit`
 *    (services/elitea-main/internal/api/v2/toolkits/handler.go:908-911)
 *    INSERTs `(name, type, description, settings, meta, author_id)` but
 *    `p_<id>.elitea_tools.owner_id` is `INTEGER NOT NULL` with no default
 *    (internal/infra/db/migrations/001_initial.sql:181), so every create
 *    fails with `null value in column "owner_id" … (SQLSTATE 23502)`.
 *    Toolkit/MCP creation is therefore impossible through the product.
 * D2 (backend, keeps the MCP create page permanently empty):
 *    `GET /elitea_core/toolkits/prompt_lib/{projectID}` is routed to
 *    `toolkitHandler.List` (router.go:645 and :670) — the *instance* list,
 *    which answers `{"rows":[],"total":0}`. The handler that returns the
 *    type→schema map the UI needs, `ListTypeSchemas`
 *    (toolkits/handler.go:231), has NO route registration anywhere. The
 *    generated client's `NOTE(W2)` claiming router.go:375 wires it is stale.
 *    Consequence: `useGetCurrentMCPSchemas` filters the keys `rows`/`total`,
 *    finds no mcp-flavoured key, and `/app/mcps/create` can never offer a
 *    type to pick. The catalogue test below asserts the rendered set equals
 *    the backend-derived set, so it passes today AND starts asserting real
 *    types the moment the route is fixed — it does not cement the bug.
 *
 * ── Genuinely untestable here ──────────────────────────────────────────
 * The end-to-end "MCP becomes usable after authorization" half of JRNY-018
 * cannot be exercised: the receiving end of the relay is
 * `features/mcps`' `McpAuthModal`/`createAuthorizationMonitor`, which is
 * only reachable from an MCP toolkit's edit screen — and no MCP toolkit can
 * exist while D1 stands. `src/features/mcps/ui/OAuthFormFields.tsx` also has
 * no production caller, so there is no OAuth-configuring form to drive. This
 * is stated here and in the run report rather than hidden behind a
 * `test.skip()`.
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
    // See D2 in the module comment: this endpoint currently answers with an
    // instance envelope instead of the type→schema map, so the derived set is
    // empty today. The assertion is written against the derived set, not
    // against "empty", so it keeps its teeth once the route is fixed.
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
    // Fails today at the seed step with HTTP 500 — see D1 in the module comment
    // and #129: `owner_id` is never INSERTed, so no MCP or toolkit can be
    // created at all. Left failing on purpose; weakening the seed assertion
    // would make a completely broken create endpoint look green.
    //
    // test.fail() rather than test.skip(): a skip runs nothing and reports
    // green, which is the exact defect this rewrite removes. This runs every
    // assertion, expects failure, and turns the suite RED the moment #129 is
    // fixed — so the annotation cannot outlive the bug unnoticed.
    //
    // Caveat, stated because a green suite must not imply more than it proves:
    // every assertion AFTER the seed is unreachable while D1 stands, so those
    // are unexecuted and unproven, not verified coverage.
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
