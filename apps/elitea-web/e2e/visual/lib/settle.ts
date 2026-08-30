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
import { expect, type Locator, type Page } from '@playwright/test';

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
 * The MAIN app's shell landmark — every `/app/**` shot in this suite waits on
 * it before the shutter opens.
 *
 * Both halves are required: the nav link proves the permission query resolved
 * (and so the nav is at full length), the project name proves the project list
 * resolved (and so the switcher is not showing its "No projects" fallback).
 *
 * `Credentials` is chosen over the other gated items only because it is gated
 * and unambiguous; any of `PERMISSION_GROUPS`' entries would do. `Applications`
 * and `Skills` would NOT — `requiredPermissionsFor` returns undefined for them,
 * so they render during load too.
 *
 * MEASURED (shell-allowed stall vs. full stall, on
 * `/settings/create-personal-token`, which has no data of its own):
 *   Credentials nav link       loaded YES  stalled no   <- permission-gated
 *   resolved project name      loaded YES  stalled no
 *   "No projects" fallback     loaded no   stalled YES
 *   Applications nav link      loaded YES  stalled YES  <- ungated, no good
 *   sidebar-create-button      loaded YES  stalled YES  <- always present
 * The first two are the landmark; the last two are why the obvious choices are
 * not. See `../routes.visual.spec.ts`'s header for the full method note.
 *
 * It lives HERE, beside `settle()` and the base mask list, for the reason that
 * file's header gives for those: two spec files need the identical guarantee,
 * and a spec file cannot be imported from another spec file without re-running
 * its `test()` registrations. Two copies would be two suites claiming the same
 * guarantee while enforcing different ones.
 *
 * The ADMIN SPA does NOT use this — its nav is not query-driven, so it has a
 * different guard of its own (`adminShellSettled` in `../admin.visual.spec.ts`).
 */
export async function shellSettled(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Credentials', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // The seeded tenant's only project (`scripts/e2e-stack.sh seed`). Asserting
  // the NAME, not merely that the switcher exists: the switcher renders either
  // way, and its loading text is the literal "No projects".
  await expect(page.locator('button').filter({ hasText: 'Default Project' }).first()).toBeVisible({
    timeout: 20_000,
  });
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
 * ── THE MEASURED NOISE FLOOR IS ZERO PIXELS (issue #233) ───────────────────
 *
 * This used to read `{ maxDiffPixelRatio: 0.002 }`, chosen under #159 on the
 * reasoning that font rasterisation and antialiasing differ enough between
 * environments that a zero tolerance produces constant false failures. Nobody
 * had measured how much noise there actually is, so nobody could see what else
 * that number was absorbing: renaming the admin nav's `Projects` label to
 * `Workspaces` — user-visible text in persistent chrome on all ten admin pages
 * — failed NO baseline.
 *
 * So it was measured, at `{ maxDiffPixels: 0 }`, over six full-suite runs in
 * the pinned container (39 shots each) in TWO environments — this repo's CI
 * (ubuntu-latest, amd64, native) and a macOS host running the same image under
 * podman with amd64 emulation — including a stack destroyed and rebuilt from an
 * empty volume, and a bundle rebuilt by a different toolchain (node 26 on the
 * host vs node 24 in the builder image):
 *
 *   threshold   worst per-shot noise across those runs
 *   ---------   --------------------------------------
 *   0.2                       0 px          (pixelmatch's default)
 *   0.1                       0 px
 *   0.05                      1 px          ← what this file now uses
 *   0.02                      9 px
 *   0.01                     20 px
 *   0                        28 px
 *
 * Not "small": renders of unchanged content are BYTE-IDENTICAL down to
 * threshold 0.1, on both machines, every run. There is no rasterisation noise
 * to protect against inside the pinned container, only the sub-threshold
 * glyph-edge jitter the last three rows show.
 *
 * ── WHY `threshold` MOVED, AND WHY IT MATTERED MORE THAN THE RATIO ─────────
 *
 * Playwright compares with pixelmatch, whose `threshold` decides whether a
 * pixel counts as different at all: `maxDelta = 35215 * threshold²` in YIQ
 * space, so the default 0.2 needs a luminance step of roughly 53/255 before ONE
 * pixel is counted. Measured on this suite: changing the dark scheme's
 * `border.lines` from #3B3E46 to #545862 — every divider, card edge and input
 * underline in the app — produced exactly ZERO differing pixels on all 39 shots
 * at threshold 0.2 AND at 0.1. No value of `maxDiffPixels` or
 * `maxDiffPixelRatio` can catch a change the comparator has already discarded.
 * At 0.05 the same change is 1,033–3,615 px per shot.
 *
 * 0.05 is therefore the operating point: the last row above where noise is
 * ~1 px, and the first where a colour-only regression is visible at all.
 *
 * ── THE SIGNAL FLOOR IS 70 PIXELS ──────────────────────────────────────────
 *
 * Five minimal changes, each built and served to the running stack, measured at
 * threshold 0.05 (page shots are 1602x848 = 1,358,496 px, so the OLD 0.002
 * allowed 2,716):
 *
 *   change                                       px/shot   old 0.002 verdict
 *   ------------------------------------------   -------   -----------------
 *   admin nav icon, outlined → filled folder      70–81    passed (38x under)
 *   nav label `Projects` → `Workspaces`          384–418   passed (6.5x under)
 *   admin nav border-right 1px → 2px             261–325   passed (8x under)
 *   `border.lines` #3B3E46 → #545862           1033–3615   passed (invisible)
 *   the accent-hue recolour found below           586–750   passed for months
 *
 * `maxDiffPixels` is an absolute count, not a ratio, because the noise it
 * covers is a handful of glyph-edge pixels and does not scale with image area —
 * a ratio makes a large page shot 7x more forgiving than a small one for no
 * measured reason.
 *
 * ── THE 70 PX SIGNAL FLOOR WAS WRONG, AND 20 WAS ABOVE A REAL SIGNAL ───────
 *
 * The five changes above were all measured in the DARK scheme. The same change
 * moves a different number of pixels in each scheme, because the count depends
 * on the contrast between the changed pixels and what they replaced — and the
 * budget was set from the dark numbers alone.
 *
 * Measured on issue #238's sidebar chevron, a 16x16 dropdown arrow added to
 * `ProjectSwitcher`, which is in every route shot. Counted with Playwright's
 * own comparator (`getComparator('image/png')`) at this file's threshold, on
 * all 7 routes that carry both schemes:
 *
 *   scheme   px/shot   verdict at maxDiffPixels: 20
 *   ------   -------   ----------------------------
 *   dark        21     failed on all 7 — by ONE pixel
 *   light       11     PASSED on all 7
 *
 * So the smallest real signal is 11 px, not 70. The budget of 20 sat ABOVE it,
 * which inverts the rule this file set for itself: a budget must sit below the
 * smallest change worth catching. The light half of the suite went on passing
 * against baselines with no chevron in them, and `--update-snapshots=changed`
 * never rewrote them, because a passing snapshot is not rewritten. Those
 * baselines had to be DELETED to be regenerated. The dark half was caught by a
 * one-pixel margin, which is luck, not a working gate.
 *
 * The noise floor was re-measured at the same time, the same way: 19
 * unchanged-content shots compared across two independent full-suite runs in
 * CI, at this threshold — min 0, max 0, mean 0 differing pixels. That agrees
 * with the 0–1 px above and is why the budget can be small.
 *
 * `maxDiffPixels: 3` therefore sits 3x above the worst noise ever observed
 * (1 px; 0 px in the runs just described) and 3.7x below the smallest real
 * signal now known (11 px) — the same shape of margin 20 was chosen for, with
 * the signal floor corrected. Anything measured below 11 px in future belongs
 * in the table above, and the budget moves with it.
 *
 * ── THIS WAS NOT HYPOTHETICAL ──────────────────────────────────────────────
 *
 * The first zero-tolerance run found three baselines
 * (`settings-personalization`, `settings-create-personal-token`,
 * `settings-project-params`) still carrying the app's OLD teal accent hue,
 * dating from f82ea3a6 (#82) while every baseline regenerated since carries the
 * magenta one. The whole of the persistent chrome — the CREATE button, the
 * ELITEA mark, the Agent HUB item — was recoloured, and it scored 586/750 px
 * against a 2,716 px budget, so the gate stayed green across every PR in
 * between. Both environments reproduced those counts to the pixel, which is
 * what proves it was a real difference rather than noise. Those three baselines
 * were regenerated in the pinned container as part of #233.
 *
 * ── WHAT WAS CONSIDERED AND REJECTED ───────────────────────────────────────
 *
 * PER-SHOT tolerances: nothing to differentiate. The noise floor is 0–1 px on
 * every shot regardless of its size or how busy it is, so a large dashboard and
 * a small dialog need the same budget.
 *
 * COMPONENT-SCOPED chrome shots (snapshot the nav, not the page) to make a
 * label change a large fraction of a small image: still not needed, but the
 * reason has shrunk. The gap between signal and noise is 11x, not the 70x this
 * note used to claim, and the amplification would be ~7x. It is now a real
 * option if a change smaller than 11 px ever has to be caught, rather than the
 * obviously-unnecessary one it reads as.
 *
 * ── WHAT A TIGHTER BUDGET DOES NOT FIX ─────────────────────────────────────
 *
 * A snapshot that PASSES is never rewritten, whatever the budget is. So a
 * baseline that drifted under the old budget stays wrong until someone deletes
 * it, and a stale baseline is indistinguishable from a correct one by looking
 * at a green run. Lowering the number shrinks the window; it does not close it.
 * `scripts/compare-visual-baselines.mjs` and the `full` regeneration mode in
 * `ci-web-e2e.yml` exist for that: a full rewrite, compared by PIXELS rather
 * than by bytes, so accumulated drift is visible in one reviewable list.
 */
export const SNAPSHOT_TOLERANCE = { maxDiffPixels: 3, threshold: 0.05 } as const;
