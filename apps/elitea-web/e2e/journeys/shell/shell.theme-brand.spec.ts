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
  // JRNY-030 end to end. Channel C is wired on BOTH halves now (issue #136 C):
  // `index.html` loads `/api/v2/branding/bootstrap.js` with a blocking script
  // tag, and `app/providers/AppProviders.tsx` feeds the validated result into
  // `BrandThemeProvider`'s `pack`. Before that the endpoint served a correct
  // pack that reached nothing at all — the compiled `DEFAULT_BRAND_PACK` always
  // won, so "without rebuild" was exactly the property that did not hold.
  //
  // THIS TEST SERVES ITS OWN PACK. Do not "simplify" it into a colour-literal
  // assertion against the deployment's pack: the LIGHT scheme's compiled
  // primary computes to `#C428DD`, which is precisely the hue elitea-main's
  // built-in default pack ships, so a literal check would have reported the
  // brand channel as working while it was entirely unwired. Serving a distinct
  // pack is what makes the assertion discriminating.

  // The endpoint itself is real — assert its contract before overriding it.
  //
  // This stack configures no BRAND_PACK_PATH, so the contract is that the
  // endpoint publishes NOTHING and the UI keeps its own compiled-in pack.
  // It used to serve elitea-main's built-in `DefaultPack()` here, which was a
  // whole-app visual regression rather than a harmless floor: channel C wins
  // over channel A whenever the global is set, and that pack states zero
  // scheme tokens, so `resolveScheme` derived all 362 ids per scheme by
  // rotating the reference ramp onto its placeholder `brand.hue` — every
  // surface in the app repainted from one colour nobody chose. Asserting the
  // global is ABSENT here is what keeps that from coming back silently.
  const brandResp = await page.request.get(BASE_URL + '/api/v2/branding/bootstrap.js', {
    failOnStatusCode: false,
  });
  expect(brandResp.status()).toBe(200);
  const body = await brandResp.text();
  expect(body).not.toContain('window.elitea_brand');

  // Serve a pack over the same endpoint, with no rebuild. This is the whole
  // point of JRNY-030: a tenant pack swap must reach the running app.
  //
  // Stated in full rather than derived from what the endpoint served, since
  // it now serves no pack to derive from. Mirrors
  // `src/shared/brand/tokens/default.pack.json`'s shape (the `BrandPack` zod
  // schema is `.strict()`, so every required key must be present and no extra
  // key may be) — same hand-mirroring convention as SCHEME_ATTRIBUTE above.
  // `schemes` are left EMPTY on purpose: that is what makes assertion 3 below
  // discriminating, because with no token stated every id must be derived
  // from `brand.hue`.
  const shellPack = {
    // REQUIRED, and a `z.literal` — a pack without it fails `safeParse`,
    // `parseBrandPack` degrades to the compiled-in pack, and the only symptom
    // is assertion 3 below reporting the compiled cyan. Omitting it is exactly
    // how this literal was wrong on its first run.
    $schema: 'https://elitea.ai/schemas/brand-pack/1.json',
    id: 'autotest-shell',
    version: '1.0.0',
    product: { name: 'Elitea-shell', shortName: 'Elitea-shell' },
    assets: {
      logoFull: '/app/brand/logo-full.svg',
      logoMark: '/app/brand/logo-mark.svg',
      favicon: '/app/brand/favicon.svg',
    },
    typography: {
      fontFamily: '"Montserrat", Roboto, Arial, sans-serif',
      fontFamilyMono: '"Roboto Mono", Consolas, "Courier New", monospace',
      baseSize: 14,
      scale: 1.2,
    },
    shape: { radiusSm: 4, radiusMd: 8, radiusLg: 16, radiusPill: 9999, density: 'comfortable' },
    locale: { default: 'en-GB', dateLocale: 'en-GB' },
    brand: { hue: '#FF00AA' },
    schemes: { light: {}, dark: {} },
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
  // `#6ae8fa` here is the compiled-in dark primary, i.e. channel C did not
  // drive the palette. The usual cause is not a broken channel but a REJECTED
  // pack: `parseBrandPack` degrades silently to channel A (logging a warn) on
  // any schema violation in `shellPack` above. With this pack the derived
  // value is `#fa6aca` — the reference cyan rotated onto `brand.hue`.
  expect(primary.toLowerCase()).not.toBe('#6ae8fa');

  // 4. ...and drive the product name in the document title
  //    (`widgets/app-shell/ui/PageTitleSetter.tsx`).
  await expect.poll(() => page.title(), { timeout: 10_000 }).toContain('Elitea-shell');

  // 5. ...and the logo asset the pack points at must resolve.
  const logo = await page.request.get(new URL(shellPack.assets.logoFull, BASE_URL).toString());
  expect(logo.status()).toBe(200);

  await checkA11y(page);
});
