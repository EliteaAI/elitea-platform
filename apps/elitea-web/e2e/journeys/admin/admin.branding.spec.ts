/**
 * Journey 38: An operator rebrands the platform from the admin console
 * (JRNY-038, ADR-0024 WP4)
 *
 * ## What this journey proves
 *
 * The Branding page is not a form over rows — it is the surface behind
 * `GET /api/v2/branding/bootstrap.js`, which every user loads. So the
 * assertion that matters is not "the page said saved" but "the bootstrap body
 * changed": after a save through the UI, the served pack carries the product
 * name, the hue and the uploaded logo path. Only a request to the real route
 * can show that; a unit test against MSW cannot.
 *
 * The upload is a real multipart POST of bytes GENERATED here (an SVG built
 * from a string), never a committed binary, and the server sniffs and stores
 * them content-addressed; the path it answers is what the page must have
 * written into the draft, which is what the bootstrap body then names.
 *
 * ## Shared state, and how it is kept honest
 *
 * The database layer of the brand pack is one row set for the whole
 * deployment, and both browser projects run this file. Every run therefore
 * takes the platform-flag WRITER lock — the branding rows are platform-wide
 * state in the same sense the feature flags are — writes project-specific
 * values so a stale write from the other project cannot satisfy the
 * assertions by accident, and restores the layer it found in `finally`, so
 * the visual baseline (`e2e/visual/admin.visual.spec.ts`, the all-inherit
 * state) and every other journey see the deployment as they found it.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { withPlatformFlagLock } from '../../fixtures/platformFlags';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

const API = `${BASE_URL}/api/v2`;
const BRANDING_URL = `${API}/admin/branding/administration`;
const ASSET_PATH_PREFIX = '/api/v2/branding/assets/logo-full/';

function probeName(projectName: string): string {
  return `E2E ${projectName} brand`;
}

/** Six-digit hex, lower-case: what the server stores and what the JSON body echoes. */
function probeHue(projectName: string): string {
  return projectName === 'chromium' ? '#3366cc' : '#cc6633';
}

/** A small logo generated from text — nothing binary is committed for this. */
function probeLogo(projectName: string): Buffer {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">',
    `<rect width="120" height="40" rx="6" fill="${probeHue(projectName)}"/>`,
    `<text x="10" y="26" font-family="sans-serif" font-size="14" fill="#ffffff">${projectName}</text>`,
    '</svg>',
  ].join('');
  return Buffer.from(svg, 'utf8');
}

async function readValues(page: Page): Promise<Record<string, unknown>> {
  const response = await page.request.get(BRANDING_URL);
  expect(response.status(), 'the branding read must be authorised for the admin persona').toBe(200);
  const body = (await response.json()) as { values: Record<string, unknown> };
  return body.values;
}

async function writeValues(page: Page, values: Record<string, unknown>): Promise<void> {
  const response = await page.request.put(BRANDING_URL, { data: { values } });
  expect(response.status(), `restoring the branding rows answered ${response.status()}`).toBe(200);
}

async function openBranding(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/branding', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'the admin SPA must serve the branding route, not 404').toBeLessThan(400);
  // The form mounts only once the settings query resolved.
  await expect(page.getByRole('textbox', { name: 'Product name' })).toBeVisible({ timeout: 20_000 });
}

adminTest('J38: a rebrand saved through the page reaches the bootstrap route', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await withPlatformFlagLock(async () => {
    const original = await readValues(page);
    try {
      await openBranding(page);
      await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();

      // The preview and the derived swatches are on screen before anything is edited.
      await expect(page.getByTestId('branding-preview-light')).toBeVisible();
      await expect(page.getByTestId('branding-preview-dark')).toBeVisible();
      const primaryBefore = await page
        .getByTestId('branding-swatch-light-primary')
        .getAttribute('data-value');

      await page.getByTestId('branding-field-product_name').fill(probeName(project));
      await page.getByTestId('branding-field-brand_hue').fill(probeHue(project));

      // The swatch strip is DERIVED from the hue through the real builder, so
      // the primary swatch must move with it.
      await expect
        .poll(async () => page.getByTestId('branding-swatch-light-primary').getAttribute('data-value'))
        .not.toBe(primaryBefore);

      // A real upload: the server answers a content-addressed path, and the
      // page shows that path (still draft state) under the control.
      await page.getByTestId('branding-upload-input-logo-full').setInputFiles({
        name: `${project}-logo.svg`,
        mimeType: 'image/svg+xml',
        buffer: probeLogo(project),
      });
      const shownPath = page.getByTestId('branding-asset-path-logo-full');
      await expect(shownPath).toContainText(ASSET_PATH_PREFIX, { timeout: 20_000 });
      const logoPath = (await shownPath.textContent())?.trim() ?? '';

      await page.getByTestId('branding-save').click();
      await expect(page.getByTestId('branding-toast-success')).toContainText('Branding saved', {
        timeout: 20_000,
      });

      // What every user will load. The body is `window.elitea_brand = {…};`,
      // a JSON pack, so the three values appear in JSON's own spelling.
      const bootstrap = await page.request.get(`${API}/branding/bootstrap.js`);
      expect(bootstrap.status()).toBe(200);
      const body = await bootstrap.text();
      expect(body).toContain(`"name":${JSON.stringify(probeName(project))}`);
      expect(body).toContain(`"hue":${JSON.stringify(probeHue(project))}`);
      expect(body).toContain(`"logoFull":${JSON.stringify(logoPath)}`);

      // The stored rows agree with the page: the read answers the same three.
      const stored = await readValues(page);
      expect(stored['product_name']).toBe(probeName(project));
      expect(stored['brand_hue']).toBe(probeHue(project));
      expect(stored['logo_full']).toBe(logoPath);

      // The layers panel names the database as the deciding layer for the
      // three fields, and the product default for one nobody set.
      const layers = page.getByTestId('branding-layers');
      await expect(layers.getByTestId('branding-layer-row-product_name')).toContainText('Set here');
      await expect(layers.getByTestId('branding-layer-row-docs_url')).toContainText('Product default');

      await checkA11y(page);
    } finally {
      await writeValues(page, original);
    }
  });
});

adminTest('J38b: the server refusal lands beside the field it names', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await withPlatformFlagLock(async () => {
    const original = await readValues(page);
    try {
      await openBranding(page);
      await page.getByTestId('branding-field-product_name').fill(probeName(project));
      await page.getByTestId('branding-field-brand_hue').fill('not a colour');
      await page.getByTestId('branding-save').click();

      // The toast carries the server's sentence, and so does the field.
      const toast = page.getByTestId('branding-toast-error');
      await expect(toast).toContainText('"brand_hue"', { timeout: 20_000 });
      await expect(page.locator('#branding-brand_hue-helper-text')).toContainText('six-digit hex');

      // Nothing was written: the refusal is a refusal, not a partial save.
      const stored = await readValues(page);
      expect(stored['product_name']).toBe(original['product_name']);
      expect(stored['brand_hue']).toBe(original['brand_hue']);

      await checkA11y(page);
    } finally {
      await writeValues(page, original);
    }
  });
});

adminTest('J38c: the Configuration page points at the Branding page instead of a plain form', async ({ page }) => {
  const response = await page.goto(BASE_URL + '/admin/app/configuration', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);
  const sections = page.getByRole('navigation', { name: 'Configuration sections' });
  await sections.getByRole('button', { name: /Branding/ }).click();
  await expect(page.getByTestId('admin-configuration-branding-card')).toBeVisible({ timeout: 20_000 });
  // No generic Save over the same rows.
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await page.getByTestId('admin-configuration-branding-link').click();
  await page.waitForURL((url) => url.pathname === '/admin/app/branding', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible({ timeout: 20_000 });
  await checkA11y(page);
});
