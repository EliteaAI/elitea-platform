/**
 * Journey 31: The admin Projects page reads the real project table, and its
 *             suspend write survives a full reload (JRNY-031)
 *
 * ## Why this journey needs to exist at all
 *
 * Before unit A14, `GET /admin/projects/{mode}` already answered 200 with a
 * `rows` array — it simply ignored `search`, `sort_by`, `sort_order` and
 * `project_type`, sent `owner_id` where the page reads `owner_name`, and
 * carried no `admin_names`, no `status` and no `counts`. So a journey asserting
 * "the page loads" or "a table is present" passes against that. And
 * `PUT /admin/project_suspend/...` had no route at all: its handler existed and
 * nothing could reach it.
 *
 * Every assertion below is therefore against SEEDED ROWS —
 * `scripts/e2e-stack.sh seed` writes three `centry.project` rows plus their
 * owner and admins, and none of those strings exists anywhere in the bundle.
 *
 * The load-bearing assertions are two:
 *   * the team and personal tabs return DIFFERENT sets, from the server;
 *   * the suspend write survives a full page reload, which a handler that
 *     answers 200 and writes nothing (#130, #180) cannot pass.
 */
import { test as adminTest, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

/** Seeded by `scripts/e2e-stack.sh seed` — see its "admin projects fixture" block. */
const SEEDED_TEAM_ACTIVE = 'e2e-team-active';
const SEEDED_TEAM_SUSPENDED = 'e2e-team-suspended';
const SEEDED_PERSONAL = 'project_user_90001';
const SEEDED_OWNER_NAME = 'E2E Project Owner';
const SEEDED_PROJECT_ADMIN = 'E2E Project Admin';

adminTest('J31: the projects table lists seeded projects with owner, admins and status', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'the admin SPA must serve the projects route, not 404').toBeLessThan(400);

  // From the DATABASE. The listing is gated server-side on
  // `projects.projects.projects.view`; the admin persona holds it via the seed,
  // so a 403 here would mean the gate and the seed have drifted apart.
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(SEEDED_TEAM_SUSPENDED)).toBeVisible();

  // The empty state and the table are mutually exclusive branches.
  await expect(page.getByText('No projects')).toHaveCount(0);
  await expect(page.getByText('Failed to load projects.')).toHaveCount(0);

  const activeRow = page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE });

  // `owner_name` and `admin_names` are the two fields the pre-A14 server never
  // sent — it emitted a bare `owner_id`. Both are resolved by the handler from
  // auth_core__user, so neither can come from the bundle.
  await expect(activeRow).toContainText(SEEDED_OWNER_NAME);
  await expect(activeRow).toContainText(SEEDED_PROJECT_ADMIN);

  // The status chip has two DIFFERENT values across the two seeded team
  // projects. A page rendering a constant — the defect the admin Users
  // reference page shipped — cannot produce both.
  await expect(activeRow.getByText('Active', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: SEEDED_TEAM_SUSPENDED }).getByText('Suspended', { exact: true }),
  ).toBeVisible();

  // Two admins on ONE project. A listing that JOINs the project-role tables
  // rather than aggregating emits the project twice — the row-multiplication
  // defect the admin user listing shipped before A14.
  await expect(page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE })).toHaveCount(1);

  await checkA11y(page);
});

adminTest('J31b: the two tabs are answered by the server and return different sets', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });

  // The personal project must NOT be on the team tab.
  await expect(page.getByText(SEEDED_PERSONAL)).toHaveCount(0);

  const [personalListing] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/projects/administration') &&
        r.url().includes('project_type=personal') &&
        r.request().method() === 'GET',
    ),
    page.getByRole('tab', { name: /Personal Projects/ }).click(),
  ]);
  expect(personalListing.status(), 'the personal listing must be authorised server-side').toBe(200);

  // The split is the SERVER's: `name LIKE 'project_user_%'`. A client-side tab
  // that filtered nothing would leave the team rows on screen.
  await expect(page.getByText(SEEDED_PERSONAL)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toHaveCount(0);
});

adminTest('J31c: search is applied by the server, not the browser', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(SEEDED_TEAM_SUSPENDED)).toBeVisible();

  const [searchListing] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/admin/projects/administration') && r.url().includes('search='),
    ),
    page.getByTestId('admin-projects-search').fill('suspended'),
  ]);
  expect(searchListing.status()).toBe(200);

  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(SEEDED_TEAM_SUSPENDED)).toBeVisible();
});

adminTest('J31d: suspending a project reaches the server and survives a full reload', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });

  const row = page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE });
  // The seed leaves this one ACTIVE; a test that started from "already
  // suspended" would prove nothing about the write.
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  const suspend = row.getByRole('button', { name: 'Suspend project' });
  await expect(
    suspend,
    'the admin persona holds projects.projects.projects.edit, so the control must be live',
  ).toBeEnabled();

  // The response is what proves the request was AUTHORISED, not merely sent.
  const [suspendResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/project_suspend/administration/') && r.request().method() === 'PUT',
    ),
    suspend.click(),
  ]);
  expect(suspendResponse.status(), 'the suspend write must be authorised server-side').toBe(200);

  // A full reload, not a client-side refetch: this is the assertion a handler
  // that answers 200 and writes nothing cannot pass — and before this unit the
  // route did not exist at all, so the request 404'd.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE });
  await expect(afterReload.getByText('Suspended', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Restore, so this journey leaves the stack as it found it and can be re-run.
  const [unsuspendResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/project_suspend/administration/') && r.request().method() === 'PUT',
    ),
    afterReload.getByRole('button', { name: 'Unsuspend project' }).click(),
  ]);
  expect(unsuspendResponse.status()).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE }).getByText('Active', { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
});

adminTest('J31e: create and delete are rendered unavailable, not wired to nothing', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });

  // Both provisioning controls are DISABLED with a stated reason rather than
  // omitted or, worse, wired to an endpoint that would half-provision a tenant.
  await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete projects' })).toBeDisabled();

  // Export is NOT in that group any more — it is real (CSV). Asserted here as
  // enabled so this journey cannot quietly go on describing it as unavailable.
  await expect(page.getByRole('button', { name: 'Export to CSV' })).toBeEnabled();

  // And the project count is unchanged by their presence: nothing on this page
  // can create or destroy a tenant.
  await expect(page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE })).toHaveCount(1);
});

adminTest('J31f: the activity drawer reads the audit trail scoped to one project', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/projects', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(SEEDED_TEAM_ACTIVE)).toBeVisible({ timeout: 20_000 });

  const row = page.getByRole('row').filter({ hasText: SEEDED_TEAM_ACTIVE });

  // The drawer reuses the deployment-wide audit endpoints. Every one of its
  // queries must carry this project's id — a drawer that dropped it would show
  // another tenant's traces under this project's name, and the rows would look
  // perfectly plausible.
  // BOTH waiters are registered before the click: the drawer issues its audit
  // and its per-user-activity queries in the same tick, so a waiter registered
  // after the first response arrives has already missed the second.
  const traceListing = page.waitForResponse(
    (r) =>
      r.url().includes('/elitea_core/audit_traces/administration') && r.request().method() === 'GET',
  );
  // `project_user_activity` was an empty-array stub with no route before this
  // unit; it is what feeds the per-member strip.
  const activity = page.waitForResponse((r) =>
    r.url().includes('/elitea_core/project_user_activity/administration'),
  );
  await row.getByRole('button', { name: 'Project activity' }).click();

  const traceResponse = await traceListing;
  expect(traceResponse.status(), 'the audit read must be authorised server-side').toBe(200);
  expect(traceResponse.url()).toContain('project_id=90001');

  const activityResponse = await activity;
  expect(activityResponse.status(), 'per-user activity must be authorised server-side').toBe(200);
  expect(activityResponse.url()).toContain('project_id=90001');

  await expect(page.getByText(`${SEEDED_TEAM_ACTIVE} (ID: 90001)`)).toBeVisible({ timeout: 15_000 });

  // The strip itself holds only unlabelled squares — the "N / M active" caption
  // is its sibling — so the count is asserted on the caption and the membership
  // on the squares' own labels. Both seeded project admins must appear, which
  // is what shows the strip is fed by the project's REAL membership rather than
  // by whatever the last member query happened to return.
  await expect(page.getByText(/\d+ \/ 2 active/)).toBeVisible({ timeout: 15_000 });
  const strip = page.getByTestId('project-user-activity');
  await expect(strip.getByLabel(new RegExp(`^${SEEDED_PROJECT_ADMIN}: `))).toBeVisible();
  await expect(strip.locator('[aria-label]')).toHaveCount(2);
});

/*
 * NOT COVERED here — deliberately, and each covered elsewhere or stated:
 *
 *  - project CREATE and DELETE. Neither is implemented: provisioning a project
 *    runs nine steps across the tenant schema, object storage, vault, RabbitMQ,
 *    InfluxDB and a system account, and deleting one runs them in reverse
 *    including `DROP SCHEMA p_<id> CASCADE`. J31e asserts that both controls
 *    are unavailable, which is the whole of what this port claims about them.
 *  - the member dialog's WRITES. They reach real handlers
 *    (`POST`/`PUT /admin/users/administration/{projectID}`) and are covered by
 *    `TestUsersWriteVerbsPersistProjectMembership` in
 *    services/elitea-main/internal/api/v2/eliteacore, which re-reads through the
 *    product's own GET, and by `src/pages/admin/Projects.test.tsx`, which
 *    asserts the exact bodies. They are not exercised here because the seeded
 *    project's membership is load-bearing for J31's `admin_names` assertion,
 *    and a journey that added a member would change what J31 asserts.
 *  - the negative authorisation case (a persona WITHOUT
 *    `projects.projects.projects.edit`). The E2E stack seeds one administration
 *    persona; `TestProjectSuspendIsRefusedWithoutTheEditPermission` and
 *    `TestProjectsListingIsRefusedWithoutTheViewPermission` cover both
 *    directions against a real database.
 *  - the export's CONTENTS. The control is real (CSV, not the reference's
 *    .xlsx — see `src/pages/admin/adminCsv.ts`), and J31e asserts it is
 *    enabled, but the bytes are asserted where they can be read:
 *    `Projects.test.tsx` reads the downloaded Blob, and `adminCsv.test.ts`
 *    covers quoting and formula-injection neutralisation. A browser download
 *    in Playwright would re-assert the same file through a much slower path.
 */
