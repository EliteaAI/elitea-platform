/**
 * Journey 29: Theme switch light↔dark, reload, persists (JRNY-029)
 * Journey 30: Brand pack loads logo + primary colour + product name without rebuild (JRNY-030)
 *
 * Spec §8.5 acceptance (from parity/manifest/shell.json JRNY-029/030).
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';

/** `shared/brand/constants.ts:27` — the attribute MUI's colour scheme selector resolves to. */
const SCHEME_ATTRIBUTE = 'data-el-scheme';
/** `shared/brand/constants.ts:9` — `cssVarPrefix: 'el'`, so every token is `--el-…`. */
const PRIMARY_VAR = '--el-palette-primary-main';

const readScheme = (page: import('@playwright/test').Page): Promise<string | null> =>
  page.evaluate((attr) => document.documentElement.getAttribute(attr), SCHEME_ATTRIBUTE);

const readPrimary = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    PRIMARY_VAR,
  );

// ─────────────────────────────────────────────────────────────────────────────
// Journey 29: Theme switch persists across reload
// ─────────────────────────────────────────────────────────────────────────────
test('J29: theme switch persists across reload', async ({ page }) => {
  // The theme control lives on the Personalization settings tab
  // (`features/settings/ui/profile/ProfilePersonalization.tsx:72` renders
  // `shared/ui/ThemeModeToggle`, a `TabGroupButton` = MUI ToggleButtonGroup).
  await page.goto(BASE_URL + '/app/settings/personalization', { waitUntil: 'domcontentloaded' });

  // The two real toggle buttons — NOT `getByRole('switch').or(getByTestId(
  // 'theme-toggle')).or(getByRole('checkbox'))`. That chain matched nothing
  // (there is no switch, no `theme-toggle` testid and no checkbox anywhere on
  // this page), so the `isVisible().catch(() => false)` + `if (!toggleVisible)
  // return;` pair below it made the whole journey a no-op — verified by the
  // fact that the test passed in 847 ms while never touching the theme.
  const dark = page.getByRole('button', { name: 'Dark', exact: true });
  const light = page.getByRole('button', { name: 'Light', exact: true });
  await expect(dark).toBeVisible({ timeout: 20_000 });
  await expect(light).toBeVisible();

  await checkA11y(page);

  // Baseline: the compiled default scheme is `dark`
  // (`shared/brand/constants.ts:35` DEFAULT_COLOR_SCHEME).
  expect(await readScheme(page)).toBe('dark');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  const darkPrimary = await readPrimary(page);
  expect(darkPrimary, 'the dark scheme must publish a primary colour token').not.toBe('');

  // ── switch to light ───────────────────────────────────────────────────────
  await light.click();

  // 1. The DOM attribute the stylesheet keys off actually flips...
  await expect
    .poll(() => readScheme(page), { timeout: 10_000 })
    .toBe('light');
  // 2. ...the control reflects it...
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  // 3. ...and a real, computed palette value changed. A stub that only wrote
  //    the attribute without a light colour-scheme block would not.
  const lightPrimary = await readPrimary(page);
  expect(lightPrimary).not.toBe('');
  expect(lightPrimary).not.toBe(darkPrimary);

  // ── reload: the choice must persist ───────────────────────────────────────
  await page.reload();
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  expect(await readScheme(page)).toBe('light');
  expect(await readPrimary(page)).toBe(lightPrimary);
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // ── restore, and prove the toggle works in the other direction too ────────
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect
    .poll(() => readScheme(page), { timeout: 10_000 })
    .toBe('dark');
  expect(await readPrimary(page)).toBe(darkPrimary);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 30: Brand pack swaps logo, primary colour, product name without rebuild
// ─────────────────────────────────────────────────────────────────────────────
test('J30: brand pack loads logo, primary colour, and product name without rebuild', async ({
  page,
}) => {
  // KNOWN-RED. The server half of channel C shipped; the client half did not,
  // so nothing about the running app is brand-pack driven — "without rebuild"
  // is exactly the property that does NOT hold.
  //
  //   * `GET /api/v2/branding/bootstrap.js` returns 200 and a valid
  //     `window.elitea_brand = {…}` snippet (measured on this stack).
  //   * `apps/elitea-web/index.html` never loads it — the served document
  //     pulls only `./config.js` and the app bundle, so `window.elitea_brand`
  //     is `undefined` in the page (measured).
  //   * `src/app/providers/AppProviders.tsx:83` renders `<BrandThemeProvider>`
  //     with no `pack` prop, and `BrandThemeProvider.tsx:81` defaults it to
  //     the COMPILED-IN `DEFAULT_BRAND_PACK`. Its own doc comment
  //     (`BrandThemeProvider.tsx:17-26`) states the channel-C wiring is "a
  //     later concern".
  //   * The two packs do not even agree: the served pack's `brand.hue` is
  //     `#C428DD`, `src/shared/brand/tokens/default.pack.json`'s is
  //     `#6ae8fa`. Any test that asserted a colour without first CHANGING the
  //     served pack could pass on that coincidence — which is why this test
  //     serves a pack of its own below rather than checking a literal.
  //
  // The previous revision `test.skip()`-ped on a 404 and otherwise asserted
  // `expect(title.length).toBeGreaterThan(0)` — true of every HTML document
  // ever served. `test.fail()`, never `test.skip()`.
  // Tracked as #136: /api/v2/branding/bootstrap.js serves a valid pack, but
  // index.html never loads it and AppProviders.tsx:83 mounts BrandThemeProvider
  // with no pack, so the compiled DEFAULT_BRAND_PACK wins. This test SERVES its
  // own pack rather than asserting a colour literal — the light scheme's compiled
  // primary coincidentally equals the served hue, so a literal would pass by luck.
  test.fail();

  // The endpoint itself is real — assert its contract before overriding it.
  const brandResp = await page.request.get(BASE_URL + '/api/v2/branding/bootstrap.js', {
    failOnStatusCode: false,
  });
  expect(brandResp.status()).toBe(200);
  const body = await brandResp.text();
  expect(body).toContain('window.elitea_brand');

  const servedPack = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as {
    product: { name: string; shortName: string };
    brand: { hue: string };
    assets: { logoFull: string };
  };
  expect(servedPack.brand.hue).toMatch(/^#[0-9a-fA-F]{6}$/);

  // Serve a DIFFERENT pack — same endpoint, no rebuild. This is the whole
  // point of JRNY-030: a tenant pack swap must reach the running app.
  const shellPack = {
    ...servedPack,
    id: 'autotest-shell',
    product: { name: 'Elitea-shell', shortName: 'Elitea-shell' },
    brand: { hue: '#FF00AA' },
  };
  let bootstrapRequested = false;
  await page.route('**/api/v2/branding/bootstrap.js', async (route) => {
    bootstrapRequested = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.elitea_brand = ${JSON.stringify(shellPack)};`,
    });
  });

  await page.goto(BASE_URL + '/app/');
  await page.waitForURL('**/chat**', { timeout: 15_000 });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });

  // 1. The app must actually fetch the pack. (This is the assertion that
  //    fails today: index.html carries no script tag for it.)
  expect(bootstrapRequested, 'the app never requested /api/v2/branding/bootstrap.js').toBe(true);

  // 2. The pack must be visible to the app...
  expect(await page.evaluate(() => JSON.stringify((window as never as { elitea_brand?: unknown }).elitea_brand ?? null))).toContain(
    'autotest-shell',
  );

  // 3. ...drive the palette — the derived primary must sit on the served hue,
  //    not on the compiled-in one...
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--el-palette-primary-main').trim(),
  );
  expect(primary).not.toBe('');
  expect(primary.toLowerCase()).not.toBe('#6ae8fa');

  // 4. ...and drive the product name in the document title
  //    (`widgets/app-shell/ui/PageTitleSetter.tsx`).
  await expect.poll(() => page.title(), { timeout: 10_000 }).toContain('Elitea-shell');

  // 5. ...and the logo asset the pack points at must resolve.
  const logo = await page.request.get(new URL(shellPack.assets.logoFull, BASE_URL).toString());
  expect(logo.status()).toBe(200);

  await checkA11y(page);
});
