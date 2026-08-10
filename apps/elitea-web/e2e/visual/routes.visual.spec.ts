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
    // The analytics date-range filter renders `now-24h … now` as formatted
    // wall-clock text (`DateRangeField`, format `dd/MM/yyyy HH:mm`). It is
    // different on every run by construction: the first observed run of this
    // job diffed a baseline reading 06/08/2026 23:21 against a page reading
    // 09/08/2026 00:51 (run 31345403013, issue #159). A locator that matches
    // nothing on the other four routes is a no-op there.
    page.locator('[data-testid="analytics-date-range"]'),
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
    // Audited under #174 and KEPT — measured, not assumed. With every `**/api/**`
    // response stalled for 30s this locator does NOT become visible inside 20s:
    // the composer is not rendered until the chat page's data arrives, so it
    // cannot photograph a loading state. The `.or(getByRole('textbox'))` arm is
    // a no-op rather than a hole: probing the loaded page for visible
    // input/textarea/contenteditable/[role=textbox] elements returns only the
    // composer's own `chat-message-input` textarea (plus one sibling textarea
    // inside the same composer) — there is no earlier textbox anywhere in the
    // shell for `.first()` to reach.
    landmark: (page) => page.getByTestId('chat-input').or(page.getByRole('textbox')).first(),
  },
  {
    // @covers /settings/personalization
    name: 'settings-personalization',
    path: '/app/settings/personalization',
    // The resolved profile block, NOT `getByRole('textbox').first()`.
    //
    // Found by the audit #174 asked for. This page's Formik form renders every
    // one of its textboxes while `useGetCurrentAuthor` is still in flight
    // (initialised from `undefined` author data); only `ProfileUserInfo`
    // switches between a Skeleton and the real name/avatar/email. So the old
    // landmark resolved during the skeleton state — the same latent weakness
    // as settings-project-params, on a page whose every visible value comes
    // from the query being waited for.
    landmark: (page) => page.getByTestId('profile-user-info'),
  },
  {
    // @covers /settings/create-personal-token
    name: 'settings-create-personal-token',
    path: '/app/settings/create-personal-token',
    // Audited under #174 and KEPT, for a different reason than chat's. This
    // locator DOES resolve with every `**/api/**` call stalled (measured) — but
    // that is not a defect here, because the screen has no server data to wait
    // for. It is a static react-hook-form: its only query,
    // `useListTokensQuery`, is passed `{ enabled: false }`, and every pixel of
    // its content area (New Token, Name, Days, 30, Generate/Discard) is
    // client-rendered. There is no loading branch it could photograph.
    //
    // The residual exposure is the app SHELL — the rail's project name comes
    // from a query — and that is shared by all five routes here, not specific
    // to this landmark. It fails LOUD rather than silent: a shell captured
    // mid-load diffs against a baseline whose shell is resolved. Recorded
    // rather than papered over; a shell-level landmark belongs with #61's
    // growth work, not here.
    landmark: (page) => page.getByRole('textbox').first(),
  },
  {
    // @covers /settings/analytics
    name: 'settings-analytics',
    path: '/app/settings/analytics',
    // The KPI row, NOT `getByRole('main')`. This screen fetches its data after
    // mount and shows a spinner meanwhile; `main` (and `#root > *`) is present
    // during the spinner, so the landmark was satisfied instantly, `settle()`'s
    // 300ms elapsed, and the committed baseline was a photograph of the
    // spinner — the precise failure this file's header warns about, sitting in
    // the suite from the day it was written and only visible once the job was
    // allowed to run (issue #159). `analytics-kpi-row` renders only from
    // resolved data.
    landmark: (page) => page.getByTestId('analytics-kpi-row'),
  },
  {
    // @covers /settings/project-params
    name: 'settings-project-params',
    path: '/app/settings/project-params',
    // The resolved body, NOT `getByRole('main').or('#root > *')`.
    //
    // That was the same landmark that turned the settings-analytics baseline
    // into a photograph of a spinner (#159): `ProjectContext` renders a bare
    // <CircularProgress> while `useGetProjectContext` is in flight, and both
    // `main` and `#root > *` are already in the tree at that moment — so the
    // wait resolved instantly, `settle()`'s 300ms elapsed, and a slow query
    // would have pinned the loading state as the reference. This baseline
    // happened to be fully rendered, so the defect was latent, not visible
    // (#174).
    //
    // `project-context-body` is rendered only from a RESOLVED query: the
    // loading branch returns the spinner, the error branch returns a banner,
    // and the no-view-permission branch returns a different banner still. None
    // of the three carries this testid, so the landmark discriminates.
    landmark: (page) => page.getByTestId('project-context-body'),
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
 *  - `/chat/:conversationId` (4 shots). Not covered, and the reason recorded
 *    here for a long time was simply false. It said the route 404s because
 *    `ConvsRepo` "is never wired and has no implementation at all" (#123).
 *    Measured against the running stack: POST
 *    /api/v2/elitea_core/conversations/prompt_lib/1 returns 201 and persists a
 *    row. The no-implementation half came from grepping the interface NAME,
 *    which a Go implementation never mentions; the never-wired half stopped
 *    being true in 3b73273.
 *
 *    The actual obstacle is determinism. Seeding a conversation on each run adds
 *    a row to the sidebar list, so consecutive runs render different lists and
 *    the snapshot diffs for reasons that have nothing to do with the UI. Fixing
 *    it means seeding to a known list state, which is the same work the
 *    rail-collapsed variants below need. Recorded as an EXEMPT entry in
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
