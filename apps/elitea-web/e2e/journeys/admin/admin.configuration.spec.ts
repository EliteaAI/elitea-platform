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
 * Most of what is left on this page is every section this platform cannot serve
 * — Pylon plugin configuration, a maintenance hook that does not exist, an LLM
 * governance surface nothing enforces. That is a true and useful thing for the
 * page to say, and it is most of what this journey asserts: not that a form
 * renders, but that each pane states a server-declared REASON and each endpoint
 * refuses the write rather than accepting and discarding it.
 *
 * **Guardrails is the exception, and is now the page's landing section.** It was
 * on the unavailable list until the toolkit surfaces, the toolkit write paths
 * and the agent tool freeze started reading `toolkit_security.*`. So this
 * journey no longer says "everything here is unavailable"; it says which
 * sections are, which one is not, and — because the difference is the whole
 * point of the page — that the two look different.
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

adminTest('J34: the sidebar marks what this deployment cannot configure', async ({ page }) => {
  await openConfiguration(page);

  await expect(page.getByText('Failed to load the configuration sections.')).toHaveCount(0);

  // Marked in the SIDEBAR, so the shape of what this deployment offers is
  // legible before the operator clicks anything.
  const marks = page.getByText('Not available here');
  await expect(marks.first()).toBeVisible();
  expect(await marks.count(), 'most Configuration sections remain unavailable').toBeGreaterThan(5);

  // Guardrails is NOT among them, and is the section the page lands on. The
  // count above cannot show that on its own: it would still pass if every
  // section were unavailable, which is what it asserted before guardrails had
  // consumers.
  const guardrails = page.getByRole('button', { name: /Guardrails/ });
  await expect(guardrails).toBeVisible();
  await expect(guardrails.getByText('Not available here')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34a: Guardrails offers a real form, including its two tool maps', async ({ page }) => {
  await openConfiguration(page);
  await page.getByRole('button', { name: /Guardrails/ }).click();

  // A save control exists here and nowhere else on this page — the difference
  // between a section with a backend and a section without one.
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The two map fields render as EDITORS, not as the "no editor for this field
  // yet" row. Guardrails is order 1, so this is the first screen of the page,
  // and `blocked_tools`/`sensitive_tools` are the substance of the feature —
  // shipping them inert would have made the landing screen a form whose two
  // most important controls do nothing.
  const addButtons = page.getByRole('button', { name: 'Add toolkit' });
  await expect(addButtons).toHaveCount(2);
  await expect(
    page.getByText('This platform has no editor for this field yet', { exact: false }),
  ).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34b: the sections with no backend say so instead of showing a form', async ({ page }) => {
  await openConfiguration(page);

  // Guardrails left this list when it gained consumers — see J34a.
  for (const section of ['Authentication', 'Maintenance', 'Advanced']) {
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
