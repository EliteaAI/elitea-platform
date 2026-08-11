/**
 * Journey 34: The admin App Requests queue reads the table the product writes,
 *             and a decision on one really lands (JRNY-034)
 *
 * ## Why this journey needs to exist at all
 *
 * Before unit A14 every endpoint behind this page answered 200 while doing
 * nothing, so "the page renders and a table is present" was true of a
 * completely unwired stack:
 *
 *  - the queue read was a `_ *http.Request` stub returning a fixed empty page,
 *    mounted UNGATED;
 *  - the decision (`PUT /admin/moderation_status/administration`) had no route
 *    at all, so approve and reject were buttons with nothing behind them;
 *  - the product-side pair that FILLS the queue answered `{"status":"approved"}`
 *    to every caller for every entity, and its POST created nothing.
 *
 * So the assertions here are against things only a working server can produce:
 *
 *  - `e2e_app_request_probe_<engine>` is seeded into `centry.moderation_state`
 *    by `scripts/e2e-stack.sh seed` and exists in no bundle. Seeing it proves
 *    the queue reads that table.
 *  - It is authored by the MEMBER persona while the page is viewed by the ADMIN
 *    one, so the requester's address on screen proves the `auth_core__user` join
 *    ran — a listing that skipped it looks identical until a real address is
 *    expected.
 *  - Decisions are verified by a RELOAD and a re-read, never by the toast.
 *  - Both halves of the security boundary are exercised as FORGED requests,
 *    because neither is visible in the UI at all: a requester must not be able
 *    to file an already-approved request, and a moderator must not be able to
 *    rewrite what was asked while answering it.
 *  - The product side is driven end to end: a request filed through
 *    `POST /admin/moderation_status/default/1/{entity}` must appear in the
 *    operator's queue. That is the connection the two stubs used to hide.
 *
 * ## How this stays re-runnable
 *
 * There is no delete endpoint for a moderation row, and no reopen either — a
 * decided request cannot be returned to `pending`, deliberately. So the seeded
 * row is treated as READ-ONLY by every test here (J34 renders it, J34c aims
 * refused forgeries at it and asserts nothing moved), and each test that needs a
 * decidable row FILES ITS OWN with a run-unique key and leaves it DECIDED. The
 * Pending tab therefore ends every run containing exactly what it started with.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

// Serial, and not because these are slow: J34 asserts the seeded row is pending
// and J34c aims writes at its id, so a concurrent test that decided it would
// make J34 fail on scheduling luck. This orders them within a browser project;
// `seededEntity` and `runKey` below keep the two projects apart, since `serial`
// does nothing across them.
adminTest.describe.configure({ mode: 'serial' });

/** Seeded by `scripts/e2e-stack.sh seed` — see its `centry.moderation_state` block. */
function seededEntity(projectName: string): string {
  return `e2e_app_request_probe_${projectName}`;
}
function seededLabel(projectName: string): string {
  return `E2E Probe ${projectName}`;
}

/**
 * A key unique to this run AND this browser engine.
 *
 * Unique per run because a row filed by a previous run still exists — nothing
 * deletes one — so a fixed key would match two rows and every `toHaveCount(1)`
 * would fail on the second run against the same stack.
 */
const RUN_ID = `${Date.now()}`;
function runEntity(projectName: string, suffix: string): string {
  return `e2e_app_request_probe_${projectName}_${suffix}_${RUN_ID}`;
}

const REQUESTER = 'e2e-member@autotest.local';
const QUEUE_URL = '/api/v2/admin/moderation_statuses/administration';
const DECISION_URL = '/api/v2/admin/moderation_status/administration';

async function openAppRequests(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/app-requests', {
    waitUntil: 'domcontentloaded',
  });
  expect(
    response?.status(),
    'the admin SPA must serve the app-requests route, not 404',
  ).toBeLessThan(400);
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
}

/** The POST the application catalogue's "Request Access" button makes. */
async function fileRequest(
  page: Page,
  entity: string,
  label: string,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ([target, issueType]) => {
      const response = await fetch(`/api/v2/admin/moderation_status/default/1/${target}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_type: issueType,
          description: 'Filed by journey 34.',
          // Both shipped clients send these two, so the server must keep
          // tolerating them even though it applies neither.
          status: 'pending',
          meta: {},
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    [entity, label] as const,
  );
}

/** Reads a request's real row straight off the queue endpoint. */
async function probeRow(
  page: Page,
  entity: string,
): Promise<{ id: number; status: string; rejection_comment: string | null }> {
  const row = await page.evaluate(
    async ([url, wanted]) => {
      const response = await fetch(`${url}?limit=100&offset=0`, { credentials: 'include' });
      const body = (await response.json()) as {
        rows?: { id: number; entity_id: string; status: string; rejection_comment: string | null }[];
      };
      return body.rows?.find((candidate) => candidate.entity_id === wanted) ?? null;
    },
    [QUEUE_URL, entity] as const,
  );
  expect(row, `the request ${entity} must be present in the queue`).not.toBeNull();
  return row as { id: number; status: string; rejection_comment: string | null };
}

adminTest('J34: the queue is the moderation table, read from the database', async ({ page }, testInfo) => {
  const entity = seededEntity(testInfo.project.name);
  await openAppRequests(page);

  // The read is gated on `admin.moderation`; the admin persona holds it via the
  // seed, so this banner appearing would mean the gate and the seed drifted.
  await expect(page.getByTestId('admin-app-requests-unavailable')).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  // The requester's ADDRESS, resolved by joining auth_core__user. The row itself
  // carries only a user id, and the member persona is not the one viewing this
  // page — so this string can only have come from the join.
  await expect(row.getByText(REQUESTER)).toBeVisible();
  // The catalogue key AND the label the requesting client displayed. The
  // reference page renders only the key.
  await expect(row.getByText(seededLabel(testInfo.project.name))).toBeVisible();
  await expect(row.getByText('Pending')).toBeVisible();

  await checkA11y(page);
});

adminTest('J34b: a request filed through the PRODUCT endpoint reaches the queue', async ({ page }, testInfo) => {
  const entity = runEntity(testInfo.project.name, 'filed');
  await openAppRequests(page);

  const filed = await fileRequest(page, entity, 'E2E Filed Probe');
  expect(filed.status, 'filing an access request must be authorised and created').toBe(201);

  // A FULL RELOAD, not a cache read: this is the assertion a POST that answers
  // 201 and writes nothing cannot pass.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row.getByText('E2E Filed Probe')).toBeVisible();

  // Reading one's own requests back answers the CALLER's rows, not a constant.
  // The stub answered `{"status":"approved"}` to this exact call.
  const readBack = await page.evaluate(async (target) => {
    const response = await fetch(`/api/v2/admin/moderation_status/default/1/${target}`, {
      credentials: 'include',
    });
    return (await response.json()) as { total?: number; rows?: { status: string }[] };
  }, entity);
  expect(readBack.total, 'the caller must see the request they just filed').toBe(1);
  expect(readBack.rows?.[0]?.status, 'a fresh request is pending, never approved').toBe('pending');

  // An entity nobody has asked about must NOT come back approved — the
  // fail-open case in one line.
  const unasked = await page.evaluate(async () => {
    const response = await fetch(
      '/api/v2/admin/moderation_status/default/1/e2e_never_requested_entity',
      { credentials: 'include' },
    );
    return (await response.json()) as { total?: number };
  });
  expect(unasked.total, 'an entity nobody requested must have no rows, not an approval').toBe(0);

  // Leave the queue as it was found: decided, so the Pending tab does not grow
  // by one row per run.
  await row.getByRole('button', { name: 'Approve request: E2E Filed Probe' }).click();
  await expect(page.getByTestId('admin-app-requests-saved')).toBeVisible();
});

adminTest('J34c: a requester cannot decide their own request, and a moderator cannot rewrite it', async ({ page }, testInfo) => {
  const entity = seededEntity(testInfo.project.name);
  await openAppRequests(page);
  const before = await probeRow(page, entity);

  // Half one: SELF-APPROVAL. pylon's create model declares
  // `status: ModerationStatus = PENDING`, which is a default and not a
  // restriction, so a body carrying "approved" is stored verbatim there — any
  // project member could file a request that arrives already decided.
  const selfApproved = await page.evaluate(async (target) => {
    const response = await fetch(`/api/v2/admin/moderation_status/default/1/${target}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issue_type: 'E2E Forged Probe',
        description: 'Already approved, thanks.',
        status: 'approved',
      }),
    });
    return { status: response.status, body: await response.text() };
  }, runEntity(testInfo.project.name, 'forged'));
  expect(
    selfApproved.status,
    'a requester deciding their own request must be refused by the SERVER, not merely absent from the UI',
  ).toBe(400);
  expect(selfApproved.body).toContain('status');

  // Half two: the MODERATOR rewriting what was asked. If the decision endpoint
  // could edit `entity_id`, an approved row would stop being evidence of what
  // was approved; `meta` is refused because the endpoint REPLACES it, so a
  // decision would destroy what the requester stored.
  for (const forgery of [
    { entity_id: 'something_else_entirely' },
    { issue_type: 'Something Else' },
    { description: 'rewritten after the fact' },
    { meta: { granted: true } },
    { user_id: 1 },
  ]) {
    const refused = await page.evaluate(
      async ([url, id, extra]) => {
        const response = await fetch(url as string, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'approved', ...(extra as object) }),
        });
        return { status: response.status, body: await response.text() };
      },
      [DECISION_URL, before.id, forgery] as const,
    );
    expect(
      refused.status,
      `a decision carrying ${Object.keys(forgery)[0]} must be refused, not silently ignored`,
    ).toBe(400);
  }

  // Half three: a rejection with no reason. pylon's field validator does not fire
  // when the key is ABSENT, so a null-reason rejection gets through there — and
  // a bare refusal is all the requester is ever told.
  const reasonless = await page.evaluate(
    async ([url, id]) => {
      const response = await fetch(url as string, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'rejected' }),
      });
      return { status: response.status, body: await response.text() };
    },
    [DECISION_URL, before.id] as const,
  );
  expect(reasonless.status, 'a rejection with no reason must be refused').toBe(400);
  expect(reasonless.body).toContain('rejection_comment');

  // Nothing moved through any of that — which is also what keeps the seeded row
  // usable by the next run.
  expect((await probeRow(page, entity)).status, 'a refused decision must not have applied').toBe(
    'pending',
  );
});

adminTest('J34d: approving reaches the server and survives a full reload', async ({ page }, testInfo) => {
  const entity = runEntity(testInfo.project.name, 'approve');
  const label = 'E2E Approve Probe';
  await openAppRequests(page);
  expect((await fileRequest(page, entity, label)).status).toBe(201);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row.getByText('Pending')).toBeVisible();

  // The response status is what proves the request was AUTHORISED, not merely
  // sent — the admin persona holds `admin.moderation.edit` via the seed.
  const [decision] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/moderation_status/administration') && r.request().method() === 'PUT',
    ),
    row.getByRole('button', { name: `Approve request: ${label}` }).click(),
  ]);
  expect(decision.status(), 'the decision must be authorised server-side').toBe(200);

  // The page says what approving DOES, and what it does is notify the requester.
  await expect(page.getByTestId('admin-app-requests-saved')).toContainText('notified');

  // A FULL RELOAD, on the tab that only shows approved rows. This is the
  // assertion a handler that answers 200 and writes nothing cannot pass.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: entity })).toHaveCount(1, {
    timeout: 20_000,
  });

  // …and it is gone from Pending, so the status filter is the SERVER's and not a
  // client-side slice of one page.
  await page.getByRole('tab', { name: 'Pending', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: entity })).toHaveCount(0);

  expect((await probeRow(page, entity)).status).toBe('approved');
});

adminTest('J34e: rejecting requires a reason, and the reason is rendered back', async ({ page }, testInfo) => {
  const entity = runEntity(testInfo.project.name, 'reject');
  const label = 'E2E Reject Probe';
  const reason = 'Not licensed for this tenant.';

  await openAppRequests(page);
  expect((await fileRequest(page, entity, label)).status).toBe(201);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  await row.getByRole('button', { name: `Reject request: ${label}` }).click();
  // The dialog names the row, so an operator working a queue can see which one
  // they are about to refuse. The reference dialog shows only "Reject Request".
  await expect(page.getByTestId('admin-app-requests-reject-subject')).toContainText(label);

  // Confirming with an empty reason must not reach the server: it would be a
  // request the client already knows is refused.
  await page.getByTestId('admin-app-requests-reject-confirm').click();
  await expect(page.getByText('A reason is required.')).toBeVisible();

  await page.getByTestId('admin-app-requests-reject-reason').fill(reason);
  const [decision] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/moderation_status/administration') && r.request().method() === 'PUT',
    ),
    page.getByTestId('admin-app-requests-reject-confirm').click(),
  ]);
  expect(decision.status()).toBe(200);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Rejected', exact: true }).click();
  const rejected = page.getByRole('row').filter({ hasText: entity });
  await expect(rejected).toHaveCount(1, { timeout: 20_000 });
  // The reason is rendered BACK. The reference page has no column for it, so an
  // operator's own words are invisible the moment the dialog closes.
  await expect(rejected.getByText(reason, { exact: false })).toBeVisible();

  expect((await probeRow(page, entity)).rejection_comment).toBe(reason);

  await checkA11y(page);
});
