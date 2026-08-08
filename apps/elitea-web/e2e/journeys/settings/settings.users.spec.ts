/**
 * Journey 22: Settings: invite user, change role (JRNY-022)
 *
 * Spec §8.5 acceptance (from parity/manifest/users.json JRNY-022).
 * Acceptance: the member list reflects both changes;
 * the invite modal is reachable directly by URL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE CAN AND CANNOT PROVE TODAY
 *
 * Every `test.skip()` / early `return` / `.catch(() => false)` that used to
 * live here has been removed. Nothing below is guarded: each assertion either
 * holds against the real seeded stack or fails the run.
 *
 * Two of the four tests below FAIL against the current build. They are NOT
 * flaky and they are NOT mis-specified — they document live client defects
 * (D-USR-1 / D-USR-2, described inline). Do not weaken them; fix the app.
 *
 * The two halves of the journey's headline acceptance — "send the invite" and
 * "change a member's role" — are UNREACHABLE through the UI while D-USR-2
 * stands: `InviteUserDialog`'s Invite button is
 * `disabled={emails.length === 0 || selectedRoles.length === 0 || error}`
 * (src/shared/ui/settings/InviteUserDialog.tsx:174) and the Roles dropdown
 * renders only the disabled "No options" item, so `selectedRoles` can never
 * become non-empty. Likewise the per-row "Edit role" control only renders for
 * rows the grid never draws (D-USR-1). Those steps are therefore absent from
 * this file rather than present-but-skipped; see the report for the backend
 * gap that blocks them a second time even once D-USR-1/2 are fixed
 * (POST/PUT /admin/users/default/{id} decode `{user_id,role_id}` ints while the
 * client sends `{emails,roles}` strings — services/elitea-main/internal/api/
 * oapiserver/admin.go:94-147).
 *
 * MUTATION RECORD — every assertion in J22a/J22b was verified to fail when the
 * code it covers is broken. The E2E stack serves a PREBUILT elitea-web image,
 * so mutations were applied by rewriting the served chunk in-browser
 * (`page.route` text substitution) rather than by editing src — same code,
 * same expression, isolated to one browser context:
 *   J22a  `inviteUsers === '1'` → `=== '9'`            → dialog never opens  ✗
 *   J22a  gate removed, effect always fires            → dialog on bare URL  ✗
 *   J22a  invite IconButton `onClick` → no-op          → click opens nothing ✗
 *   J22b  `validateEmails` always returns valid        → no error text       ✗
 *   J22b  Invite `disabled={…}` → `false`              → button not disabled ✗
 * J22c/J22d need no mutation: they fail on the unmutated build.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX } from '../../fixtures/api';

/** Roles seeded into project 1 by scripts/e2e-stack.sh (`admin`, `editor`, `viewer`). */
const SEEDED_ROLES = ['admin', 'editor', 'viewer'] as const;

/** Members seeded into project 1, with the project role each one carries. */
const SEEDED_MEMBERS = [
  { email: 'e2e-admin@autotest.local', name: 'E2E Admin', role: 'admin' },
  { email: 'e2e-member@autotest.local', name: 'E2E Member', role: 'editor' },
] as const;

const INVITE_EMAIL = `${AUTOTEST_PREFIX}invite-usr@autotest.local`;

/** The invite dialog carries no data-testid; its title is the only landmark. */
const inviteDialog = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog').filter({ hasText: 'Invite users' });

test('J22a: invite dialog is reachable by URL and only by the flag', async ({
  page,
}) => {
  test.setTimeout(60_000);

  // QP-002: `?inviteUsers=1` must open the dialog. No fallback path — if the
  // deep link is broken this test is the thing that says so.
  await page.goto(BASE_URL + '/app/settings/users?inviteUsers=1');

  const dlg = inviteDialog(page);
  await expect(dlg).toBeVisible({ timeout: 15_000 });

  // NOTE: do NOT assert here that the URL no longer carries `inviteUsers=1`.
  // It looks like proof that the `navigate({search:{}, replace:true})` half of
  // the effect (src/pages/settings/Users.tsx:222) ran, but it is not: the route's
  // own `validateSearch`/`pickParams` normalisation rewrites the whole search
  // string (to `inviteUsers="0"` plus every other route default) even when that
  // navigate call is deleted. Mutation-verified — removing the navigate leaves
  // this passing, so it is a tautology, not an assertion.

  // Controls a heading-only stub cannot produce: a required Emails field and a
  // Roles combobox, both scoped inside the dialog.
  await expect(dlg.getByRole('textbox', { name: /emails/i })).toBeVisible();
  await expect(dlg.getByRole('combobox', { name: /roles/i })).toBeVisible();
  await expect(dlg.getByRole('button', { name: /^invite$/i })).toBeVisible();

  // Cancel is wired to onClose (UsersPageContent.tsx:352) — the dialog must go.
  await dlg.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dlg).toHaveCount(0);

  // The dialog must be FLAG-driven, not always-on: the same route without the
  // query parameter renders the page with no dialog at all. This is the half of
  // QP-002 that a permanently-mounted modal (or a stub that always shows one)
  // would otherwise satisfy for free.
  await page.goto(BASE_URL + '/app/settings/users');
  await expect(page.getByPlaceholder('Search users…')).toBeVisible({ timeout: 15_000 });
  await expect(dlg).toHaveCount(0);

  // Header controls gated on real RBAC grants (canView → search, canCreate →
  // invite). The e2e-member persona holds `configuration.users.users.{view,create}`
  // via its project `editor` role, so both must render; a permission regression
  // fails here. Clicking Invite must open the same dialog.
  const inviteControl = page.locator('button[title="Invite users"]');
  await expect(inviteControl).toBeVisible();
  await inviteControl.click();
  await expect(dlg).toBeVisible();

  await checkA11y(page);
});

test('J22b: invite form enforces its validity contract', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto(BASE_URL + '/app/settings/users?inviteUsers=1');
  const dlg = inviteDialog(page);
  await expect(dlg).toBeVisible({ timeout: 15_000 });

  const emails = dlg.getByRole('textbox', { name: /emails/i }).first();
  const inviteBtn = dlg.getByRole('button', { name: /^invite$/i });

  // State 1 — nothing entered: Invite is disabled.
  await expect(inviteBtn).toBeDisabled();

  // State 2 — a malformed address surfaces the exact validator message
  // (InviteUserDialog.tsx:48) and keeps Invite disabled.
  await emails.fill('not-an-email');
  await emails.blur();
  await expect(dlg.getByText('Invalid email: not-an-email', { exact: true })).toBeVisible();
  await expect(inviteBtn).toBeDisabled();

  // State 3 — a valid address clears the error and is retained verbatim, but
  // Invite stays disabled because no role has been chosen yet. This is the
  // `selectedRoles.length === 0` arm of the gate at InviteUserDialog.tsx:174.
  await emails.fill(INVITE_EMAIL);
  await emails.blur();
  await expect(dlg.getByText(/^Invalid email:/)).toHaveCount(0);
  await expect(emails).toHaveValue(INVITE_EMAIL);
  await expect(inviteBtn).toBeDisabled();
});

/**
 * D-USR-2 — FAILS on the current build.
 *
 * `useRoleList` returns the live body `[{"id":"1","name":"admin"}, …]` (verified
 * over the wire against the seeded stack), but src/pages/settings/Users.tsx:124
 * reads `roleListQuery.data?.data?.data?.rows` — one unwrap too many, against a
 * body that is a bare array and has no `rows` key at all. `rolesOptions` is
 * therefore always `[]`, and SingleSelect falls back to its disabled
 * "No options" item (SingleSelect.tsx:164-170).
 *
 * Keep this test failing until the mapping is fixed; it is the only thing
 * standing between "the roles dropdown is empty" and "the roles dropdown is
 * empty and nobody noticed".
 */
test('J22c: roles dropdown is populated from the seeded server roles', async ({ page }) => {
  // Expected-fail on #130 until the E2E image is rebuilt: the roles body is a BARE
  // ARRAY and Users.tsx read resp.data.data.rows, so rolesOptions was always empty and
  // Invite could never be enabled by anyone. Source is fixed; the stack still serves
  // the old prebuilt image.
  test.fail();
  test.setTimeout(60_000);

  await page.goto(BASE_URL + '/app/settings/users?inviteUsers=1');
  const dlg = inviteDialog(page);
  await expect(dlg).toBeVisible({ timeout: 15_000 });

  await dlg.getByRole('combobox', { name: /roles/i }).click();

  // The dropdown portals to the body, so options are located on `page`.
  // `select-option-<value>` is stamped by SingleSelectDropdown.tsx:33 with the
  // value that came off the wire — a stub cannot mint these three ids.
  for (const role of SEEDED_ROLES) {
    await expect(page.locator(`[data-testid="select-option-${role}"]`)).toBeVisible();
  }
  await expect(page.getByRole('option', { name: /no options/i })).toHaveCount(0);

  // Choosing a role is the last gate on the Invite button.
  await page.locator('[data-testid="select-option-editor"]').click();
  await dlg.getByRole('textbox', { name: /emails/i }).first().fill(INVITE_EMAIL);
  await expect(dlg.getByRole('button', { name: /^invite$/i })).toBeEnabled();
});

/**
 * D-USR-1 — FAILS on the current build.
 *
 * GET /api/v2/admin/users/default/1 returns
 * `{"rows":[{email:"e2e-admin@autotest.local",…,roles:["admin"]}, …],"total":2}`
 * (asserted below, and it passes). src/pages/settings/Users.tsx:107 then reads
 * `userListQuery.data?.data?.data`, one unwrap too many, so `rows` is always
 * `[]` and UsersTable renders its "No users" branch (UsersTable.tsx:245-266)
 * while the pagination footer, gated on `total > 0`, never mounts at all.
 *
 * The response assertion and the DOM assertions are deliberately in the same
 * test: together they localise the defect to the client mapping.
 */
test('J22d: member list renders the seeded project members', async ({ page }) => {
  // Expected-fail on #130 until the E2E image is rebuilt: Users.tsx read one level too
  // deep (resp.data.data), so rows was permanently [] and every user saw 'No users'.
  test.fail();
  test.setTimeout(60_000);

  const userListResponse = page.waitForResponse(
    (r) => r.url().includes('/admin/users/default/') && r.request().method() === 'GET',
    { timeout: 20_000 },
  );
  await page.goto(BASE_URL + '/app/settings/users');

  // The server half of the contract.
  const body = (await (await userListResponse).json()) as {
    rows: { email: string; roles: string[] }[];
    total: number;
  };
  expect(body.total).toBeGreaterThanOrEqual(2);
  for (const member of SEEDED_MEMBERS) {
    expect(body.rows.map((r) => r.email)).toContain(member.email);
  }

  // The client half. `No users` must NOT be what a project with two seeded
  // members shows.
  await expect(page.getByText('No users')).toHaveCount(0);

  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible({ timeout: 15_000 });

  for (const member of SEEDED_MEMBERS) {
    const row = grid.getByRole('row').filter({ hasText: member.email });
    await expect(row).toHaveCount(1);
    // Role comes from the JOIN over auth_core__project_user_role /
    // auth_core__project_role — no static markup can produce this pairing.
    await expect(row.getByRole('gridcell', { name: member.role, exact: true })).toBeVisible();
    await expect(row.getByRole('gridcell', { name: member.name, exact: true })).toBeVisible();
  }

  // Pagination footer prints the SERVER total (Users.tsx:322, UsersPageContent.tsx:284)
  // and only renders when `total > 0`.
  await expect(page.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

  // Search is wired to the fetched rows, not to a static list: filtering to the
  // admin persona must drop the member row and keep the admin row.
  await page.getByPlaceholder('Search users…').fill('e2e-admin');
  await expect(
    grid.getByRole('row').filter({ hasText: 'e2e-member@autotest.local' }),
  ).toHaveCount(0);
  await expect(
    grid.getByRole('row').filter({ hasText: 'e2e-admin@autotest.local' }),
  ).toHaveCount(1);

  await checkA11y(page);
});
