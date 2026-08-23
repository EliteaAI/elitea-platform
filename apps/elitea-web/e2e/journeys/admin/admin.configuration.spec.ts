/**
 * Journey 34: Admin › Configuration states what it cannot configure (JRNY-034)
 *
 * ## What this journey is now, and why it changed
 *
 * It used to be "a platform setting saved here is the setting the product
 * reads", over the `resources` section. Unit A14's **Features** page took that
 * section — the reference puts it there (`ConfigurationPage.jsx` subtracts it
 * via `MOVED_TO_FEATURES`; `FeaturesPage.jsx` renders it as "Help Center"), and
 * #217 recorded that it had parked the section here only because the server's
 * schema had it and because leaving it out would have kept #26 open for another
 * unit. The round trip it proved now lives in journey 35 (`admin.features.spec.ts`),
 * unchanged in substance and asserted against the same public route.
 *
 * What is left on this page is every section this platform cannot serve — Pylon
 * plugin configuration, a maintenance hook that does not exist, an LLM
 * governance surface nothing enforces. That is a true and useful thing for the
 * page to say, and it is what this journey asserts: not that a form renders, but
 * that each pane states a server-declared REASON and each endpoint refuses the
 * write rather than accepting and discarding it.
 *
 * Before unit A14 every one of those sections answered 200 on both verbs — the
 * GET with schema defaults, the PUT with an empty object and the request body
 * never read. A journey asserting "a configuration form is present and saving
 * shows a toast" would have passed against all of it.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

adminTest.describe.configure({ mode: 'serial' });

async function openConfiguration(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/configuration', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status(), 'the admin SPA must serve the configuration route, not 404').toBeLessThan(400);
  // The sidebar rendering at all proves the SCHEMA read was authorised; an
  // empty one would mean the read is unwired, which reads identically to a
  // deployment with no sections.
  await expect(page.getByRole('button', { name: /Guardrails/ })).toBeVisible({ timeout: 20_000 });
}

adminTest('J34: every section except MCP Servers is marked unavailable before it is opened', async ({ page }) => {
  await openConfiguration(page);

  await expect(page.getByText('Failed to load the configuration sections.')).toHaveCount(0);

  // Marked in the SIDEBAR, so the shape of what this deployment offers is
  // legible before the operator clicks anything.
  const marks = page.getByText('Not available here');
  await expect(marks.first()).toBeVisible();
  // Still > 5, unchanged from before this branch: the catalogue took ONE
  // section out of the unavailable set and 11 remain. Lowering the bound to
  // absorb the change would have weakened the assertion for nothing.
  expect(await marks.count(), 'the Pylon-configuration sections are all unavailable').toBeGreaterThan(5);

  // MCP Servers is the ONE exception, and the exception is the point: the
  // section still declares an `unavailable_reason` — true of the plugin-config
  // value endpoints, which cannot serve a catalogue that carries a client
  // secret — but it also declares a `managed_surface`, and the page renders
  // that surface's editor instead. Marking it "Not available here" would send
  // an operator away from the only page that can edit it.
  const mcpEntry = page.getByRole('button', { name: /MCP Servers/ });
  await expect(mcpEntry).toBeVisible();
  await expect(mcpEntry.getByText('Not available here')).toHaveCount(0);

  // And no save control exists anywhere on the page. The catalogue editor's
  // own Save lives inside its dialog, which no assertion here has opened.
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34a: the MCP Servers section renders its editor, not a refusal', async ({ page }) => {
  await openConfiguration(page);

  await page.getByRole('button', { name: /MCP Servers/ }).click();

  // The editor's own control, so this proves the dedicated surface MOUNTED —
  // not merely that the refusal notice is absent, which a blank pane would also
  // satisfy.
  await expect(page.getByTestId('admin-mcp-servers-add')).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The catalogue read is authorised and answered. A fresh deployment catalogues
  // nothing, so the empty state is the truthful branch here; the error alert
  // would mean the route refused, which is what this asserts is NOT happening.
  await expect(page.getByTestId('admin-mcp-servers-empty')).toBeVisible();
  await expect(page.getByTestId('admin-mcp-servers-error')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34b: the sections with no backend say so instead of showing a form', async ({ page }) => {
  await openConfiguration(page);

  for (const section of ['Guardrails', 'Authentication', 'Maintenance', 'Advanced']) {
    await page.getByRole('button', { name: new RegExp(section) }).click();
    const notice = page.getByTestId('admin-configuration-unavailable');
    await expect(notice).toBeVisible();
    // The reason names the system, so an operator can tell "this platform
    // cannot configure that" from "that is configured to its defaults". A form
    // over defaults would say the second when the truth is the first.
    await expect(notice).toContainText(/Pylon|gateway|page of their own/);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  }

  await checkA11y(page);
});

adminTest('J34c: an unavailable section refuses its write rather than discarding it', async ({ page }) => {
  await openConfiguration(page);

  // Forged: the page offers no control at all for this section, which is the
  // point — the refusal must be the SERVER's, not the absence of a button.
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v2/admin/plugin_config_values/administration/auth', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { oidc_client_secret: 'hunter2' } }),
    });
    return response.status;
  });
  expect(status, 'an unavailable section must refuse its write, not accept and discard it').toBe(501);
});

adminTest('J34d: the sections the Features page owns are not offered here', async ({ page }) => {
  await openConfiguration(page);

  // One section editable from two pages would be two drafts of one row, and the
  // two pages would disagree about whether it is dirty. The partition is
  // server-declared (`page: "features"`); this asserts the client honours it.
  for (const moved of ['Help Center', 'MCP Configuration', 'Agent Publishing', 'Voice Features']) {
    await expect(page.getByRole('button', { name: new RegExp(moved) })).toHaveCount(0);
  }
});
