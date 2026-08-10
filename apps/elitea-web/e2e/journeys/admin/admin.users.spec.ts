/**
 * Journey 27: Admin SPA is served with server-injected config, and lists the
 *             real users from the database (JRNY-027)
 * Journey 28: An admin write reaches the database and survives a reload
 *             (JRNY-028)
 *
 * ## What changed in unit A14, and why these are now stronger
 *
 * Until A14 `src/entries/admin/main.tsx` was a ~160-line PLACEHOLDER with ZERO
 * network calls: hardcoded `DEFAULT_ROLE_PERMISSIONS`, toggles written to
 * `sessionStorage` under `el.admin.rolePermissions`, and a `user_email`
 * fallback of `'admin@example.com'`. The two journeys here were narrowed to
 * match: J27 asserted the injected `window.admin_ui_config` and that the words
 * "Elitea Admin" appeared; J28 asserted that a roles matrix rendered. Their
 * headers said, in as many words, "do NOT add persistence or
 * permission-semantics assertions here until a real admin backend exists —
 * they would be asserting the placeholder."
 *
 * That backend now exists. `GET /admin/auth_users/administration` reads
 * `auth_core__user`; `POST /admin/auth_users/administration` and
 * `PUT /admin/user_suspend/administration/{id}` write it, gated server-side on
 * the `admin.auth.users` permission resolved from `auth_core__user_role`. So
 * the constraint the old headers described is lifted, and both journeys now
 * assert against the database instead of against a placeholder.
 *
 * The roles matrix J28 used to assert is GONE — it was the placeholder's
 * sessionStorage toy, not a product surface, and A14 deleted it along with the
 * rest of that entry. J28 is repointed at the strongest thing that now exists
 * in its place: a write that must survive a full page reload. That is the
 * assertion the sessionStorage version could never make honestly, since it
 * would have passed with no admin backend in existence at all.
 */
import { test as adminTest, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

interface AdminUIConfig {
  readonly vite_server_url?: string;
  readonly vite_base_uri?: string;
  readonly user_email?: string;
  readonly permissions?: readonly string[];
  readonly roles?: readonly string[];
}

/** Seeded by `scripts/e2e-stack.sh seed`. */
const SEEDED_ADMIN = 'e2e-admin@autotest.local';
const SEEDED_MEMBER = 'e2e-member@autotest.local';

adminTest('J27: the admin SPA is served with injected config and lists database users', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/users', { waitUntil: 'domcontentloaded' });

  // The Go handler must actually serve it. A 404 here means the route mount or
  // the static dir is broken.
  expect(response?.status(), 'admin SPA must be served, not 404').toBeLessThan(400);

  // The injected config remains a real integration: handler.go replaces the
  // `<!-- admin_ui_config -->` marker at request time. If the marker, the
  // handler, or the built index.html drift apart, this is the only thing that
  // notices.
  const config = await page.evaluate(
    () => (window as unknown as { admin_ui_config?: AdminUIConfig }).admin_ui_config,
  );
  expect(config, 'window.admin_ui_config must be injected by adminui/handler.go').toBeDefined();
  expect(config?.vite_base_uri, 'vite_base_uri must name the admin base path').toContain('/admin');

  // The listing must come from the DATABASE. Both personas are seeded rows in
  // auth_core__user, and neither string appears anywhere in the bundle — the
  // placeholder rendered `window.admin_ui_config.user_email` and a literal
  // "admin" role, which is precisely why it could never have passed this.
  await expect(page.getByText(SEEDED_ADMIN)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(SEEDED_MEMBER)).toBeVisible();

  // The empty state and the table are mutually exclusive branches; a listing
  // that silently resolved to zero rows is the #130/#132 failure shape.
  await expect(page.getByText('No users')).toHaveCount(0);

  // The tab counts come from the same response's `counts`, which is computed
  // over ALL users and is what labels the two tabs.
  await expect(page.getByRole('tab', { name: /Platform Users \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /System Users \(\d+\)/ })).toBeVisible();

  await checkA11y(page);
});

adminTest('J28: suspending a user is written to the database and survives a reload', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/users', { waitUntil: 'domcontentloaded' });

  const memberRow = page.getByRole('row').filter({ hasText: SEEDED_MEMBER });
  await expect(memberRow).toBeVisible({ timeout: 15_000 });

  // Precondition, asserted rather than assumed: the seed creates this user
  // un-suspended, and a test that started from "already suspended" would prove
  // nothing about the write.
  await expect(memberRow.getByText('Active')).toBeVisible();

  const suspend = memberRow.getByRole('button', { name: 'Suspend user' });
  await expect(suspend, 'the admin persona holds admin.auth.users, so the control must be live').toBeEnabled();

  // The response is what proves the request was AUTHORISED, not merely sent.
  // Before A14's seed change no persona held an administration-mode
  // permission, so this same click produced a 403 while the page still listed
  // users perfectly — a stack that looks working and is not.
  const [suspendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/admin/user_suspend/administration/') && r.request().method() === 'PUT'),
    suspend.click(),
  ]);
  expect(suspendResponse.status(), 'the suspend write must be authorised server-side').toBe(200);

  // A full reload, not a client-side refetch: this is the assertion a handler
  // that answers 200 and writes nothing (#130, #180) cannot pass, and the one
  // the deleted sessionStorage version of this journey only pretended to make.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = page.getByRole('row').filter({ hasText: SEEDED_MEMBER });
  await expect(afterReload.getByText('Suspended')).toBeVisible({ timeout: 15_000 });

  // Restore, so this journey leaves the stack as it found it and can be re-run.
  const [unsuspendResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/admin/user_suspend/administration/') && r.request().method() === 'PUT'),
    afterReload.getByRole('button', { name: 'Unsuspend user' }).click(),
  ]);
  expect(unsuspendResponse.status()).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('row').filter({ hasText: SEEDED_MEMBER }).getByText('Active'),
  ).toBeVisible({ timeout: 15_000 });
});

/*
 * NOT COVERED here — deliberately, and each covered elsewhere or tracked:
 *
 *  - the super_admin escalation guard (grant/revoke). It needs a persona
 *    WITHOUT `admin.auth.users.super_admin`, which the E2E stack seeds only one
 *    of; `TestSetAdminRoleGuardsSuperAdminEscalation` in
 *    services/elitea-main/internal/api/v2/admin covers all four of its branches
 *    against a real database.
 *  - delete. It is destructive and the two seeded personas are load-bearing for
 *    every other journey in this suite;
 *    `TestAuthUsersDeleteRemovesTheUser` covers it, re-reading through the
 *    product's own GET handler.
 *  - user activity and Excel export — both are rendered DISABLED with a stated
 *    reason (no audit-trail API; no spreadsheet dependency). See
 *    `src/pages/admin/Users.test.tsx`, which asserts the disabled state.
 *  - the ten other admin sections (Projects, Secrets, LiteLLM, Audit Trail, …).
 *    Not ported yet — issue #200 lists them.
 */
