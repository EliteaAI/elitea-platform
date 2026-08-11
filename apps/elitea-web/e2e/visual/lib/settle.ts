/**
 * Helpers shared by every `@visual` spec.
 *
 * They live here rather than in `routes.visual.spec.ts` because a second spec
 * file (`admin.visual.spec.ts`) needs the identical ones, and importing them
 * from a `*.spec.ts` would re-run that file's `test()` registrations inside the
 * importer — every route snapshot would be taken twice, under two names.
 * `playwright.config.ts`'s `testMatch` is `/visual\/.+\.spec\.ts/`, so nothing
 * under `visual/lib/` is collected as a test.
 *
 * There is exactly one definition of `settle()` and one base mask list, which
 * is the point: two copies drifting apart would mean two suites claiming the
 * same guarantees while enforcing different ones.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * Regions whose content is legitimately different on every run — timestamps,
 * relative dates, generated ids. Masked rather than asserted so the suite fails
 * on LAYOUT and STYLE changes only, which is what it is for. Masking is the
 * honest alternative to a high `maxDiffPixels`, which would hide real drift
 * everywhere instead of in the two places it is expected.
 */
export function volatileRegions(page: Page): Locator[] {
  return [
    page.locator('[data-testid$="-timestamp"]'),
    page.locator('time'),
    // The analytics date-range filter renders `now-24h … now` as formatted
    // wall-clock text (`DateRangeField`, format `dd/MM/yyyy HH:mm`). It is
    // different on every run by construction: the first observed run of this
    // job diffed a baseline reading 06/08/2026 23:21 against a page reading
    // 09/08/2026 00:51 (run 31345403013, issue #159). A locator that matches
    // nothing on the other routes is a no-op there.
    page.locator('[data-testid="analytics-date-range"]'),
  ];
}

/**
 * Fonts loaded, animations frozen, caret hidden — the three things that make
 * two renders of an unchanged screen differ.
 */
export async function settle(page: Page): Promise<void> {
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

/**
 * The comparison options every shot in this suite uses.
 *
 * `maxDiffPixelRatio` is deliberately small: a permissive threshold turns a
 * green suite into no suite.
 */
export const SNAPSHOT_TOLERANCE = { maxDiffPixelRatio: 0.002 } as const;
