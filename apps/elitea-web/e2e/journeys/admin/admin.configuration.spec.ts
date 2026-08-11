/**
 * Journey 34: A platform setting saved on Admin › Configuration is the setting
 *             the product reads (JRNY-034)
 *
 * ## Why this journey needs to exist at all
 *
 * Before unit A14 this page's PUT did not read its request body — it answered
 * `200 {"values":{},"requires_restart":[]}` unconditionally — and its GET
 * returned the schema's DEFAULTS for every section at once, ignoring the section
 * in the URL. So a save reported success, a reload showed the value it had
 * always shown, and nothing had been written. A journey that asserted "a
 * configuration form is present and saving shows a toast" would have passed
 * against all of that.
 *
 * The assertions here are therefore against things only a working server can
 * produce:
 *
 *  - The value survives a FULL RELOAD, and is then visible on `/help-center` —
 *    a different page, a different route, a different user-facing surface. That
 *    is the end-to-end claim issue #26 is about: the Help Center's cards render
 *    "No links configured" because the endpoint behind them returned
 *    `max_file_size` and friends rather than resource links.
 *  - The sections this deployment cannot serve state a REASON. They have no
 *    store and no consumer — they configure Pylon plugin runtimes — and a form
 *    over them would be worse than an empty table: the operator would believe
 *    the setting took effect.
 *  - A `javascript:` link URL is refused by the SERVER, not merely by the form.
 *    These entries become anchors on a page every authenticated user opens.
 *
 * ## Per-engine partitioning
 *
 * There is ONE platform configuration table and `fullyParallel` is on, so
 * chromium and webkit run this file concurrently against the same rows.
 * `describe.configure({ mode: 'serial' })` orders tests within a project and
 * does nothing across them. Each engine therefore owns a different resource
 * CARD — real fields of the real section, not a test-only key.
 *
 * The journey restores what it changed, so it is re-runnable against a stack
 * that was not re-seeded.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

adminTest.describe.configure({ mode: 'serial' });

/** The card this browser project owns. See the header. */
function ownedCard(projectName: string): {
  title: string;
  linksLabel: string;
  cardName: string;
  linksKey: string;
} {
  return projectName === 'chromium'
    ? {
        title: 'Documentation Card Title',
        linksLabel: 'Documentation Links',
        cardName: 'Documentation',
        linksKey: 'resources_documentation_links',
      }
    : {
        title: 'Tutorials Card Title',
        linksLabel: 'Tutorials Links',
        cardName: 'Tutorials',
        linksKey: 'resources_tutorials_links',
      };
}

function probeTitle(projectName: string): string {
  return `E2E ${projectName} handbook`;
}

function probeLink(projectName: string): { title: string; url: string } {
  return {
    title: `E2E ${projectName} link`,
    url: `https://docs.example.com/${projectName}`,
  };
}

async function openConfiguration(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/configuration', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status(), 'the admin SPA must serve the configuration route, not 404').toBeLessThan(400);
  // Resources is the only section this deployment can serve, so it is what the
  // page opens on — and its presence proves the SCHEMA read was authorised.
  await expect(page.getByRole('button', { name: /Resources/ })).toBeVisible({ timeout: 20_000 });
}

adminTest('J34: the page opens on the section this deployment can actually serve', async ({ page }, testInfo) => {
  await openConfiguration(page);
  const card = ownedCard(testInfo.project.name);

  // A 403 here would mean the `runtime.plugins` gate and the seed have drifted
  // apart; an empty sidebar would mean the schema read is unwired.
  await expect(page.getByText('Failed to load the configuration sections.')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: card.title })).toBeVisible();

  // The unavailable sections are marked BEFORE they are opened. Discovering it
  // only on arrival makes the page feel broken rather than scoped.
  await expect(page.getByText('Not available here').first()).toBeVisible();

  await checkA11y(page);
});

adminTest('J34b: a saved setting survives a reload and reaches the Help Center', async ({ page }, testInfo) => {
  await openConfiguration(page);
  const card = ownedCard(testInfo.project.name);
  const link = probeLink(testInfo.project.name);

  const title = page.getByRole('textbox', { name: card.title });
  // The seed clears this card, so the baseline is the schema default. Starting
  // from "already set to the probe value" would prove nothing about the write.
  await expect(title).toHaveValue(card.cardName);

  await title.fill(probeTitle(testInfo.project.name));

  // Every link interaction is scoped to the OWNED card's editor. Both engines
  // run this file at once against one platform-wide table, so `.last()` over
  // the page's link fields would sometimes be the other engine's row.
  const editor = page.getByTestId(`admin-config-links-${card.linksKey}`);
  await editor.getByRole('button', { name: `Add link — ${card.linksLabel}` }).click();
  await editor.getByRole('textbox', { name: 'URL' }).last().fill(link.url);
  await editor.getByRole('textbox', { name: 'Title', exact: true }).last().fill(link.title);

  const [saved] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/plugin_config_values/administration/resources') &&
        r.request().method() === 'PUT',
    ),
    page.getByRole('button', { name: 'Save' }).click(),
  ]);
  expect(saved.status(), 'the configuration write must be authorised server-side').toBe(200);

  // A FULL RELOAD, not a cache read. This is the assertion a handler that
  // answers 200 and writes nothing cannot pass — and it is exactly what the
  // PUT this replaced did.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openConfiguration(page);
  await expect(page.getByRole('textbox', { name: card.title })).toHaveValue(
    probeTitle(testInfo.project.name),
  );

  // …and the product reads it. A different page, a different route, a different
  // audience: this is issue #26's end-to-end claim.
  await page.goto(BASE_URL + '/app/help-center', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: link.title })).toHaveAttribute('href', link.url, {
    timeout: 20_000,
  });
});

adminTest('J34c: the server refuses a link URL that would run in a reader’s browser', async ({ page }, testInfo) => {
  await openConfiguration(page);
  const card = ownedCard(testInfo.project.name);

  // Forged, not typed. The form warns about the scheme, so typing it would only
  // prove the form does — and a client-side check is not a boundary. This posts
  // the request the form declines to make.
  const refused = await page.evaluate(async (key) => {
    const response = await fetch('/api/v2/admin/plugin_config_values/administration/resources', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: { [key]: [{ title: 'Docs', url: 'javascript:alert(document.cookie)' }] },
      }),
    });
    return { status: response.status, body: await response.text() };
  }, card.linksKey);

  expect(
    refused.status,
    'a link scheme that executes in every reader’s browser must be refused by the SERVER',
  ).toBe(400);
  expect(refused.body).toContain('http or https');

  // And nothing was stored: the Help Center must not be carrying it.
  await page.goto(BASE_URL + '/app/help-center', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Docs' })).toHaveCount(0);
});

adminTest('J34d: an unknown key is refused rather than silently dropped', async ({ page }) => {
  await openConfiguration(page);

  const refused = await page.evaluate(async () => {
    const response = await fetch('/api/v2/admin/plugin_config_values/administration/resources', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { resources_backdoor: 'x' } }),
    });
    return { status: response.status, body: await response.text() };
  });

  // A caller that believes it set something the schema does not declare has a
  // wrong model of the system, and a 200 confirms it.
  expect(refused.status).toBe(400);
  expect(refused.body).toContain('resources_backdoor');
});

adminTest('J34e: the sections with no backend say so instead of showing a form', async ({ page }) => {
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

  // Their endpoints refuse too, not just the page.
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

  await checkA11y(page);
});

adminTest('J34f: the probe values are restored so the run is repeatable', async ({ page }, testInfo) => {
  await openConfiguration(page);
  const card = ownedCard(testInfo.project.name);

  const title = page.getByRole('textbox', { name: card.title });
  await title.fill(card.cardName);

  // Remove the link this run added, from the OWNED card's editor only.
  const editor = page.getByTestId(`admin-config-links-${card.linksKey}`);
  const remove = editor.getByRole('button', { name: /^Remove link/ });
  if ((await remove.count()) > 0) {
    await remove.last().click();
  }

  const [saved] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/admin/plugin_config_values/administration/resources') &&
        r.request().method() === 'PUT',
    ),
    page.getByRole('button', { name: 'Save' }).click(),
  ]);
  expect(saved.status()).toBe(200);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openConfiguration(page);
  await expect(page.getByRole('textbox', { name: card.title })).toHaveValue(card.cardName);
});
