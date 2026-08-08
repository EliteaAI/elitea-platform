/**
 * Snapshot coverage for the routes `parity/screenshot-index.json` marks
 * `wiringStatus: wired` — the only ones whose UI is real enough that a baseline
 * means something. See `e2e/visual/README.md` before adding to this file, in
 * particular the rule that baselines are only ever generated inside
 * `mcr.microsoft.com/playwright:v1.62.0-noble`.
 *
 * Each spec navigates, waits for a landmark that a heading-only stub cannot
 * satisfy, masks the regions that legitimately vary run to run, and snapshots.
 * The landmark wait matters: `toHaveScreenshot` on a page that has not finished
 * rendering produces a baseline of a spinner, and then every future run matches
 * it.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';

/**
 * Regions whose content is legitimately different on every run — timestamps,
 * relative dates, generated ids. Masked rather than asserted so the suite fails
 * on LAYOUT and STYLE changes only, which is what it is for. Masking is the
 * honest alternative to a high `maxDiffPixels`, which would hide real drift
 * everywhere instead of in the two places it is expected.
 */
function volatileRegions(page: Page) {
  return [
    page.locator('[data-testid$="-timestamp"]'),
    page.locator('time'),
  ];
}

async function settle(page: Page): Promise<void> {
  // Fonts must be loaded before the snapshot, or the first run captures a
  // fallback-font layout and pins it as truth.
  await page.evaluate(() => document.fonts.ready);
  // Kill animation/transition timing as a diff source.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
  await page.waitForTimeout(300);
}

interface VisualRoute {
  readonly name: string;
  readonly path: string;
  /** A landmark a stub cannot render. Waited for before snapshotting. */
  readonly landmark: (page: Page) => ReturnType<Page['locator']>;
}

/*
 * Each entry carries an `@covers <route>` annotation naming the
 * `parity/screenshot-index.json` route it claims, verbatim.
 * `scripts/check-visual-coverage.mjs` counts ONLY exact matches.
 *
 * That gate first inferred coverage from navigation, and it lied: matching a
 * route's static prefix meant `/chat/:conversationId` counted as covered because
 * a spec navigated to `/app/chat`. It reported 15/15 wired shots while this very
 * file documented those four shots as uncovered. Declared coverage cannot
 * over-report.
 */

const ROUTES: readonly VisualRoute[] = [
  {
    // @covers /chat
    name: 'chat-empty-state',
    path: '/app/chat',
    landmark: (page) => page.getByTestId('chat-input').or(page.getByRole('textbox')).first(),
  },
  {
    // @covers /settings/personalization
    name: 'settings-personalization',
    path: '/app/settings/personalization',
    landmark: (page) => page.getByRole('textbox').first(),
  },
  {
    // @covers /settings/create-personal-token
    name: 'settings-create-personal-token',
    path: '/app/settings/create-personal-token',
    landmark: (page) => page.getByRole('textbox').first(),
  },
  {
    // @covers /settings/analytics
    name: 'settings-analytics',
    path: '/app/settings/analytics',
    landmark: (page) => page.getByRole('main').or(page.locator('#root > *')).first(),
  },
  {
    // @covers /settings/project-params
    name: 'settings-project-params',
    path: '/app/settings/project-params',
    landmark: (page) => page.getByRole('main').or(page.locator('#root > *')).first(),
  },
];

for (const route of ROUTES) {
  test(`@visual ${route.name}`, async ({ page }) => {
    await page.goto(BASE_URL + route.path, { waitUntil: 'domcontentloaded' });
    await expect(route.landmark(page)).toBeVisible({ timeout: 20_000 });
    await settle(page);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: false,
      mask: volatileRegions(page),
      // Small tolerance for the last of the antialiasing noise. Deliberately
      // NOT large: a permissive threshold turns a green suite into no suite.
      maxDiffPixelRatio: 0.002,
    });
  });
}

/*
 * NOT COVERED, and why — keep this current, it is the honest half of the suite:
 *
 *  - `/chat/:conversationId` (4 shots). UNVERIFIED, not skipped. This entry
 *    previously said the route 404s because `ConvsRepo` "is never wired and has
 *    no implementation at all" (#123). Both halves were wrong: the
 *    no-implementation claim came from grepping the interface NAME, which Go
 *    implementations never mention, and the wiring landed in 3b73273 — 23
 *    conversation routes now register. What is still unestablished is whether
 *    creating a conversation actually succeeds, because no run has exercised it
 *    against an image built after that commit. Recorded as an EXEMPT entry in
 *    scripts/check-visual-coverage.mjs, which prints it on every run — a
 *    permanently-failing spec would just be noise, and a silent skip is what
 *    this whole effort exists to remove.
 *  - The rail-collapsed variants (4 shots: chat-empty-rail-collapsed,
 *    chat-empty-conversations-collapsed, chat-empty-both-collapsed,
 *    chat-active-rail-collapsed). Each needs a deterministic collapsed-sidebar
 *    state; `sidebarCollapsed.store` persists, so these need explicit setup
 *    rather than whatever the previous spec left behind.
 *  - Light theme (6 of the 15 wired shots). Every spec here captures the
 *    default theme only. A light-mode pass needs the theme toggled
 *    deterministically before the snapshot.
 *  - The 48 shots whose routes are not `wiringStatus: wired`. Snapshotting them
 *    would make stub UI the official reference.
 */
