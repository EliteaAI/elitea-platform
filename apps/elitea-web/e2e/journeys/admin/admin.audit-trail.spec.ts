/**
 * Journey 29: The admin Audit Trail reads the real audit table, and the trace
 *             and span views disagree the way they should (JRNY-029)
 *
 * ## Why this journey needs to exist at all
 *
 * Before unit A14, two of this page's four endpoints were stubs
 * (`{"items":[],"total":0}` and `{"data":[]}`, request discarded, database
 * untouched) and the other two had no route. A journey that only asserted "the
 * page loads" or "a table is present" would have passed against that. So every
 * assertion below is against SEEDED ROWS — `scripts/e2e-stack.sh seed` writes
 * four `centry.audit_events` rows forming two traces, and none of those strings
 * exists anywhere in the bundle.
 *
 * The load-bearing assertion is the LAST one: the same four rows are 2 rows in
 * the Traces view and 4 in the Spans view. A stub, a client-side grouping, or a
 * view that quietly queried the wrong endpoint all collapse that difference.
 */
import { test as adminTest, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

/** Seeded by `scripts/e2e-stack.sh seed` — see its "audit trail fixture" block. */
const SEEDED_ROOT_ACTION = 'POST /chat/e2e';
const SEEDED_SECOND_TRACE = 'GET /agents/e2e';
const SEEDED_LLM_SPAN = 'completion/e2e';
const SEEDED_ERROR_SPAN = 'search/e2e';

adminTest('J29: the audit trail lists seeded traces, and expands one into its spans', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/audit', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'the admin SPA must serve the audit route, not 404').toBeLessThan(400);

  // From the DATABASE. The reads are gated server-side on
  // `models.admin.audit_trail.view`; the admin persona holds it via the seed,
  // so a 403 here would mean the gate and the seed have drifted apart.
  await expect(page.getByText(SEEDED_ROOT_ACTION)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(SEEDED_SECOND_TRACE)).toBeVisible();

  // The empty state and the table are mutually exclusive branches. Both stubs
  // this page replaced would land here.
  await expect(page.getByText('No traces found')).toHaveCount(0);

  // The trace row reports the SERVER's aggregate over the trace's three spans,
  // which no client-side count of the (still collapsed) panel could produce.
  const alphaRow = page.getByTestId('audit-trace-row').filter({ hasText: SEEDED_ROOT_ACTION });
  await expect(alphaRow).toBeVisible();
  await expect(alphaRow.getByText('3', { exact: true })).toBeVisible();

  // Expanding fetches only that trace's spans, lazily.
  await alphaRow.getByRole('button', { name: 'Expand trace' }).click();
  await expect(page.getByText(SEEDED_LLM_SPAN)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(SEEDED_ERROR_SPAN)).toBeVisible();
  // The single-span trace's span is NOT pulled in: the panel is filtered by
  // trace_id, not showing whatever the last query happened to return.
  await expect(page.getByTestId('audit-trace-span-row')).toHaveCount(3);

  await checkA11y(page);
});

adminTest('J29b: the trace and span views report different counts for the same rows', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/audit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_ROOT_ACTION)).toBeVisible({ timeout: 20_000 });

  // Two traces over four spans. These are two different SERVER endpoints
  // answering two different questions; the seed is chosen so they cannot agree
  // by accident, and so a view wired to the wrong one is visible here.
  await expect(page.getByTestId('audit-trace-row')).toHaveCount(2);

  const [spanListing] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/elitea_core/audit/administration') && r.request().method() === 'GET',
    ),
    page.getByRole('tab', { name: 'Spans' }).click(),
  ]);
  expect(spanListing.status(), 'the span listing must be authorised server-side').toBe(200);

  await expect(page.getByText(SEEDED_LLM_SPAN)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('audit-span-row')).toHaveCount(4);

  // The error span's status code is rendered from the row's own column. Every
  // field on this page was checked against the real table for exactly this
  // reason — the admin Users reference page rendered a chip from a column that
  // does not exist, so it showed one constant for every row.
  await expect(page.getByTestId('audit-span-row').filter({ hasText: SEEDED_ERROR_SPAN })).toContainText('500');
});

adminTest('J29c: the errors-only filter is applied by the server, not the browser', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/audit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_ROOT_ACTION)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('tab', { name: 'Spans' }).click();
  await expect(page.getByTestId('audit-span-row')).toHaveCount(4);

  await page.getByLabel('Errors only').check();

  const [filtered] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/elitea_core/audit/administration') && r.url().includes('is_error=true'),
    ),
    page.getByRole('button', { name: 'Apply' }).click(),
  ]);
  expect(filtered.status()).toBe(200);

  // One of the four seeded spans is an error. The listing is paginated
  // server-side over a table that is unbounded in production, so a client-side
  // filter would only ever narrow the page already loaded.
  await expect(page.getByTestId('audit-span-row')).toHaveCount(1);
  await expect(page.getByTestId('audit-span-row')).toContainText(SEEDED_ERROR_SPAN);
});

/*
 * NOT COVERED here — deliberately, and each covered elsewhere or stated:
 *
 *  - the heatmap's drill-down. The seeded rows land in whichever 1-minute
 *    bucket the seed ran in, so a journey clicking a specific cell would be
 *    asserting against the clock. `src/pages/admin/AuditTrail.test.tsx`
 *    ("drills the tables into the exact bucket and duration band") asserts the
 *    date/duration bounds it sends against a fixed fixture, and
 *    `TestAuditHeatmapBucketsSpansByTimeAndDurationBand` in
 *    services/elitea-main asserts the bucketing itself against a real database.
 *  - the permission gate returning 403 for a persona WITHOUT
 *    `models.admin.audit_trail.view`. The E2E stack seeds one admin persona and
 *    the member persona has no admin-panel session at all;
 *    `TestRequireCentralPermissions*` in internal/api/middleware covers the
 *    gate's four branches.
 *  - sort order and pagination beyond one page — four seeded rows cannot fill a
 *    page. Covered by `TestAuditTrailPaginationIsStableAcrossTiedTimestamps`
 *    against a real database.
 *  - the nine other admin sections. Not ported yet — issue #200 lists them.
 */
