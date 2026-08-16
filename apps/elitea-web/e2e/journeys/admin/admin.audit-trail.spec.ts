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
import { readFileSync } from 'node:fs';

import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { AUDIT_FIXTURE_ANCHOR, BASE_URL, E2E_TIMEZONE, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

/** Seeded by `scripts/e2e-stack.sh seed` — see its "audit trail fixture" block. */
const SEEDED_ROOT_ACTION = 'POST /chat/e2e';
const SEEDED_SECOND_TRACE = 'GET /agents/e2e';
const SEEDED_LLM_SPAN = 'completion/e2e';
const SEEDED_ERROR_SPAN = 'search/e2e';

/* ── the day this page is asked about (issue #214) ────────────────────────────
 *
 * This page opens on a `Today` preset — `DEFAULT_PRESET` in
 * `src/pages/admin/auditFormat.ts` — and sends the browser's local midnight to
 * the server as `date_from`. So every assertion below depends on the browser
 * and the seed agreeing about which day it is, and NOTHING made them agree:
 *
 *  - the seed runs once, at the front of the run; this journey asserts minutes
 *    or hours later. A run that seeded at 23:59 and arrived here at 00:01 read
 *    an empty table, and reported it as "no audit rows rendered" — the same
 *    symptom the page being broken would produce.
 *  - the two even measured the day in different zones: the browser in the
 *    runner's, the seed in the postgres session's.
 *
 * Both are removed rather than papered over. `E2E_TIMEZONE` pins one zone for
 * both sides (see playwright.config.ts), and `seedAnchor` below pins one
 * INSTANT: the seed publishes the timestamps it actually wrote, and each test
 * freezes its browser clock just past the last of them. The window then holds
 * the rows by construction, at any hour, on either side of any midnight.
 *
 * Not solved by widening the filter — that would stop exercising the default
 * preset an operator actually arrives on, which is the thing worth testing.
 * Not solved by `retries` either: after midnight every attempt reads the same
 * empty window, so the suite would fail three times or pass an hour later, and
 * either way the signal would be the time of day rather than the code.
 */
interface AuditFixtureAnchor {
  readonly timeZone: string;
  readonly rows: number;
  readonly firstRow: string;
  readonly lastRow: string;
  readonly localDay: string;
}

function seedAnchor(): AuditFixtureAnchor {
  let raw: string;
  try {
    raw = readFileSync(AUDIT_FIXTURE_ANCHOR, 'utf8');
  } catch {
    throw new Error(
      `The audit fixture anchor is missing: ${AUDIT_FIXTURE_ANCHOR}\n` +
        'Journey 29 pins its clock to the day the audit rows were seeded on, and the seed ' +
        'writes that day out. Run `./scripts/e2e-stack.sh seed` against the stack under test.',
    );
  }
  const anchor = JSON.parse(raw) as AuditFixtureAnchor;
  expect(
    anchor.rows,
    `The seed reported ${anchor.rows} audit rows, not 4. The stack this run is pointed at was ` +
      'seeded without them, so the table below would be empty for a reason that has nothing to ' +
      'do with the page.',
  ).toBe(4);
  return anchor;
}

/**
 * Open the audit trail with the browser's clock frozen one minute after the
 * last seeded row, and report the window the page will therefore ask for.
 *
 * `setFixedTime`, not `install`: it fixes `Date.now()` and `new Date()` and
 * leaves every timer running, so react-query, MUI and the SSE transport behave
 * exactly as they do in an unfrozen run. Only the page's idea of "now" moves,
 * which is the one thing this journey needs to hold still.
 *
 * One minute AFTER the last row, so all four rows are in the past — an audit
 * trail showing events from the future would be a strange thing to assert
 * against. The seed's own clamp keeps the four rows inside a single local day,
 * so this instant is on that day too.
 */
async function openAuditTrail(page: Page): Promise<{ anchor: AuditFixtureAnchor; emptyWindowHint: string }> {
  const anchor = seedAnchor();
  const frozenNow = new Date(new Date(anchor.lastRow).getTime() + 60_000);
  await page.clock.setFixedTime(frozenNow);

  const emptyWindowHint =
    `The four seeded audit rows must be inside the page's default \`Today\` window. ` +
    `The seed wrote them on ${anchor.localDay} in ${anchor.timeZone} ` +
    `(${anchor.firstRow} … ${anchor.lastRow}), and this browser's clock is frozen at ` +
    `${frozenNow.toISOString()} in ${E2E_TIMEZONE}. An empty table here means the window and ` +
    `the fixture are on different days (#214), not that the page failed to read the database.`;

  // Registered BEFORE the navigation: the listing goes out as the page mounts,
  // and this is the only place the window the page CHOSE is visible. Reading it
  // back off the filter fields would read what the page renders, not what it
  // asked the server for.
  const listing = page.waitForRequest(
    (r) => r.url().includes('/elitea_core/audit_traces/administration') && r.method() === 'GET',
  );
  const response = await page.goto(BASE_URL + '/admin/app/audit', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'the admin SPA must serve the audit route, not 404').toBeLessThan(400);

  // The seed measured the day in `anchor.timeZone`; the page measures it in the
  // zone the browser reports. A mismatch means playwright.config.ts stopped
  // pinning `timezoneId`, and this journey would go back to passing for all but
  // twenty minutes of the day. Say so here rather than at midnight.
  const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(
    browserZone,
    `The browser is in ${browserZone} and the seed measured its day in ${anchor.timeZone}. ` +
      'Both must read `E2E_TZ`: playwright.config.ts pins the browser, scripts/e2e-stack.sh ' +
      'anchors the fixture.',
  ).toBe(anchor.timeZone);

  // The page must still be opening on its DEFAULT preset, and that default must
  // still contain the fixture. Without this the journey could keep passing over
  // a page that had quietly stopped opening on `Today`, or over a fixture that
  // had drifted out of it — and the only symptom of either is an empty table.
  const requested = new URL((await listing).url()).searchParams;
  const dateFrom = requested.get('date_from');
  const dateTo = requested.get('date_to');
  expect(dateFrom, 'the listing must carry the default window as `date_from`').not.toBeNull();
  expect(dateTo, 'the listing must carry the default window as `date_to`').not.toBeNull();
  expect(
    new Date(String(dateFrom)).getTime(),
    `The page asked for events from ${dateFrom}, which is after the first seeded row ` +
      `${anchor.firstRow}. ${emptyWindowHint}`,
  ).toBeLessThanOrEqual(new Date(anchor.firstRow).getTime());
  expect(
    new Date(String(dateTo)).getTime(),
    `The page asked for events up to ${dateTo}, which is before the last seeded row ` +
      `${anchor.lastRow}. ${emptyWindowHint}`,
  ).toBeGreaterThanOrEqual(new Date(anchor.lastRow).getTime());

  return { anchor, emptyWindowHint };
}

adminTest('J29: the audit trail lists seeded traces, and expands one into its spans', async ({ page }) => {
  const { emptyWindowHint } = await openAuditTrail(page);

  // From the DATABASE. The reads are gated server-side on
  // `models.admin.audit_trail.view`; the admin persona holds it via the seed,
  // so a 403 here would mean the gate and the seed have drifted apart.
  await expect(page.getByText(SEEDED_ROOT_ACTION), emptyWindowHint).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(SEEDED_SECOND_TRACE), emptyWindowHint).toBeVisible();

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
  const { emptyWindowHint } = await openAuditTrail(page);
  await expect(page.getByText(SEEDED_ROOT_ACTION), emptyWindowHint).toBeVisible({ timeout: 20_000 });

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
  const { emptyWindowHint } = await openAuditTrail(page);
  await expect(page.getByText(SEEDED_ROOT_ACTION), emptyWindowHint).toBeVisible({ timeout: 20_000 });

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
