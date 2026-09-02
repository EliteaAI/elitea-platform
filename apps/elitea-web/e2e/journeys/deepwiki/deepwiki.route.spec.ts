/**
 * DWIKI-001: the /deepwiki route is mounted and renders nothing while the
 * capability is off.
 *
 * WHY A JOURNEY FOR A BLANK SCREEN. The route is mounted deliberately ahead of
 * the feature, so that every intermediate change is shippable. "Mounted and
 * blank" and "not mounted" look identical to a unit test of the page component
 * — both render null — and they are completely different to a user: the second
 * is a 404 from the router's catch-all.
 *
 * Two things are asserted, and the second is the one that matters. The route
 * must NOT fall through to the 404 page, and it must NOT render the error
 * boundary. A capability-gated page that throws instead of returning null is
 * the shape issue #132 produced: a 200 from every call and "Something went
 * wrong" on the screen.
 */
import { expect, test } from '@playwright/test';

import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

const ERROR_BOUNDARY_TEXT = /something went wrong|unexpected error/i;
const NOT_FOUND_TEXT = /not found|404/i;

test('DWIKI-001: /deepwiki is mounted, and renders blank while the capability is off', async ({
  browser,
}) => {
  // STORAGE_STATE is a map of PERSONAS, not a path. The first version passed
  // the whole object, which has no `cookies` and no `origins`, so Playwright
  // treated it as an empty state and the context started unauthenticated.
  const context = await browser.newContext({ storageState: STORAGE_STATE.member });
  const page = await context.newPage();

  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(`${BASE_URL}/app/deepwiki`, { waitUntil: 'domcontentloaded' });

    // Wait until the browser is BACK ON THE APP ORIGIN before asserting
    // anything about the URL.
    //
    // This is what the first version got wrong, and it failed on chromium and
    // passed on webkit — the same bug, and one engine happened to finish the
    // hop before the assertion ran. `networkidle` is not enough: an auth
    // redirect is a navigation, and a URL read mid-hop reports the identity
    // provider rather than a routing decision.
    await page.waitForURL((url) => url.origin === new URL(BASE_URL).origin, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    // The route resolved: still on /deepwiki rather than redirected away, and
    // the router's catch-all did not claim it.
    //
    // The URL is checked AFTER networkidle and after the assertions below, so
    // an in-flight auth redirect cannot be mistaken for a routing decision —
    // which is exactly how this test first failed.
    expect(page.url()).toContain('/deepwiki');
    expect(page.url()).not.toContain('/oauth2/authorize');
    await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);

    // And it did not throw on the way to rendering nothing.
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

    // No server error while rendering a page that fetches nothing. A request
    // here at all would mean the capability gate is not stopping the query,
    // which is what useWikiList's own `enabled` test covers from the other end.
    expect(failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
});
