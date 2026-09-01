/**
 * Every credential path still authenticates after validatePrincipal was made
 * to fail closed.
 *
 * WHAT CHANGED, AND WHY THIS EXISTS.
 * `internal/api/middleware/auth.go`'s validatePrincipal used to return
 * `(user, nil)` when a deployment composed no PrincipalValidator. The
 * forwarded path guarded nil separately; X-API-Key, the `elitea_session`
 * cookie and Bearer did not, so on such a deployment an HMAC-valid cookie
 * authenticated a user the service never looked up. The helper now refuses.
 *
 * The refusal half is unit-tested per path
 * (`auth_validator_absent_test.go`) — it cannot be reproduced here, because
 * production composition ALWAYS supplies the validator, which is the point.
 * What this journey covers is the half those unit tests cannot: that the
 * change did not break real logins against a real server.
 *
 * The assertion is deliberately about 401s specifically rather than "the page
 * looks right". A principal-validation regression is invisible in a
 * screenshot — the shell renders, and only the data calls behind it fail.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL } from '../../../playwright.config';

test('JP1: an authenticated session makes API calls without a single principal refusal', async ({
  page,
}) => {
  const unauthorized: string[] = [];

  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/v2/')) return;
    // 401 is the status validatePrincipal refuses with. 403 is authorisation
    // and belongs to the permission gates, not here.
    if (response.status() === 401) unauthorized.push(`${response.status()} ${url}`);
  });

  await page.goto(BASE_URL + '/app/');

  // Wait for the shell to have actually issued its authenticated reads rather
  // than asserting on an empty network log — a page that never got as far as
  // calling the API would otherwise "pass" with zero 401s.
  const permissions = page.waitForResponse(
    (r) => r.url().includes('/api/v2/auth/permissions/') && r.status() === 200,
    { timeout: 30_000 },
  );
  await permissions;

  await expect(page).toHaveTitle(/Elitea/);
  expect(unauthorized, `principal validation refused authenticated requests:\n${unauthorized.join('\n')}`).toEqual([]);
});
