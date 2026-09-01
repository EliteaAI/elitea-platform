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
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();

  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(`${BASE_URL}/app/deepwiki`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // The route resolved: the URL is still /deepwiki rather than a redirect,
    // and the router's catch-all did not claim it.
    expect(page.url()).toContain('/deepwiki');
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
