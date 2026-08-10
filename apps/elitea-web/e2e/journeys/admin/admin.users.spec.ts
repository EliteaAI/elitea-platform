/**
 * Journey 27: Admin SPA is served with server-injected config (JRNY-027)
 * Journey 28: Admin SPA mounts its roles view (JRNY-028)
 *
 * NARROWED, disclosed — read this before widening them again.
 *
 * `src/entries/admin/main.tsx` is a 160-line PLACEHOLDER with **zero network
 * calls**: `DEFAULT_ROLE_PERMISSIONS` is hardcoded in the frontend, toggles are
 * written to `sessionStorage` under `el.admin.rolePermissions`, and `user_email`
 * falls back to `'admin@example.com'`. The real admin UI (verified against the
 * legacy stack on 2026-08-07) has ELEVEN sections — Users, Roles, Projects,
 * Secrets, LiteLLM, LLM Gateway, App Requests, Configuration, Features, Audit
 * Trail, System — over ~15k platform users, all database-backed.
 *
 * The previous versions of these two journeys asserted PERSISTENCE: J28 toggled
 * a permission, saved, reloaded, and asserted the new value stuck. It did stick
 * — in sessionStorage — so the test passed, and would have kept passing with no
 * admin backend in existence at all. J27 was worse: its only assertions were
 * `expect(bodyIsVisible).toBe(true)` (always true) and that the URL it had just
 * navigated to contained the path it had just navigated to.
 *
 * What IS real and worth guarding is the server-side integration:
 * `internal/api/adminui/handler.go` replaces an `<!-- admin_ui_config -->`
 * marker with a script defining `window.admin_ui_config`
 * (`vite_server_url`/`vite_base_uri`/`user_id`/`user_name`/`user_email`/
 * `permissions`/`roles`). That handler, the SPA build, and the route mount can
 * all break independently, and nothing else covers them.
 *
 * So these journeys now assert exactly that, and claim nothing about admin
 * behaviour. Do NOT add persistence or permission-semantics assertions here
 * until a real admin backend exists — they would be asserting the placeholder.
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

adminTest('J27: the admin SPA is served with server-injected config', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/users', { waitUntil: 'domcontentloaded' });

  // The Go handler must actually serve it. A 404 here means the route mount or
  // the static dir is broken — previously this was a `test.skip()`.
  expect(response?.status(), 'admin SPA must be served, not 404').toBeLessThan(400);

  // The injected config is the real integration: handler.go replaces the
  // `<!-- admin_ui_config -->` marker at request time. If the marker, the
  // handler, or the built index.html drift apart, this is the only thing that
  // notices.
  const config = await page.evaluate(
    () => (window as unknown as { admin_ui_config?: AdminUIConfig }).admin_ui_config,
  );
  expect(config, 'window.admin_ui_config must be injected by adminui/handler.go').toBeDefined();
  expect(config?.vite_base_uri, 'vite_base_uri must name the admin base path').toContain('/admin');

  // And the bundle must actually mount — a served-but-blank page is the failure
  // this whole effort exists to catch.
  await expect(page.getByText('Elitea Admin').first()).toBeVisible({ timeout: 10_000 });

  await checkA11y(page);
});

adminTest('J28: the admin SPA mounts its roles view', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/roles', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'admin roles route must be served, not 404').toBeLessThan(400);

  // Client-side routing must resolve /roles to a rendered matrix, not a blank
  // div. Asserting the ROLE NAMES the placeholder defines, so this fails if the
  // bundle stops mounting — while deliberately asserting nothing about what
  // toggling them does, because today it does nothing server-side.
  const matrix = page.getByRole('table').first();
  await expect(matrix).toBeVisible({ timeout: 10_000 });
  for (const role of ['admin', 'editor', 'viewer']) {
    await expect(matrix.getByText(role, { exact: true }).first()).toBeVisible();
  }

  await checkA11y(page);
});

/*
 * NOT COVERED — and deliberately so:
 *
 *  - that toggling a permission persists anywhere but sessionStorage
 *  - that permissions/roles from `window.admin_ui_config` gate anything
 *  - the ten other admin sections the real product has (Users list, Projects,
 *    Secrets, LiteLLM, LLM Gateway, App Requests, Configuration, Features,
 *    Audit Trail, System)
 *
 * These need a real admin backend first. Tracked separately — see the admin
 * placeholder issue rather than widening these journeys.
 */
