/**
 * Journey 35: Admin › Service Descriptors states why it is empty, and its
 *             endpoints refuse rather than pretend (JRNY-035)
 *
 * ## Why a deliberately unavailable page still needs a journey
 *
 * Because "unavailable" is a claim that decays. Before unit A14 this page's
 * listing answered 200 with three hardcoded rows — `elitea_core`, `auth` and
 * `indexer`, all "active" at version "2.0.0" — which are Pylon plugin names, not
 * providers, in a shape the client does not even read. An operator reading that
 * would have concluded the platform had three healthy services registered. The
 * registration endpoints, meanwhile, had no route at all and a dead handler
 * answering `{"ok": true}` to a body it discarded.
 *
 * A page that hardcoded its own "not available" text would look correct against
 * all of that. So the assertions here are against things only the SERVER can
 * produce:
 *
 *  - the sentence on screen is the one the ENDPOINT returns, checked by fetching
 *    the endpoint from the page and comparing the two;
 *  - the refusal arrives WITH the permission held, so a 403-for-everyone
 *    deployment cannot pass as an unavailable one;
 *  - both registration verbs are refused, forged directly, because no control on
 *    the page will issue them;
 *  - no listing rows are rendered, and nothing on the page offers to delete one.
 *
 * That last set is the assertion that would catch someone later wiring any of
 * these three routes back to a stub.
 *
 * ## Per-engine partitioning
 *
 * None is needed. Every test here is a read or a refused write; nothing this
 * journey does changes state, so chromium and webkit can run it concurrently
 * against one stack. It is re-runnable for the same reason.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

const DESCRIPTORS_ENDPOINT = '/api/v2/elitea_core/admin/administration';
const REGISTER_ENDPOINT = '/api/v2/elitea_core/register_descriptor/1';

async function openServiceDescriptors(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/service-descriptors', {
    waitUntil: 'domcontentloaded',
  });
  expect(
    response?.status(),
    'the admin SPA must serve the service-descriptors route, not 404',
  ).toBeLessThan(400);
  await expect(page.getByRole('heading', { name: 'Service Descriptors' })).toBeVisible({
    timeout: 20_000,
  });
}

adminTest('J35: the page states the server’s own reason for being empty', async ({ page }) => {
  await openServiceDescriptors(page);

  const notice = page.getByTestId('admin-service-descriptors-unavailable');
  await expect(notice).toBeVisible();

  // The reason names the SUBSYSTEM, so an operator can tell "this platform does
  // not have a provider hub" from "no providers happen to be registered". Those
  // are different facts and only one of them is actionable.
  await expect(notice).toContainText(/provider hub/i);

  // A load error would mean the page could not reach the endpoint at all, and a
  // 403 would mean the gate and the seed had drifted apart. Either would leave
  // an operator with no explanation.
  await expect(page.getByTestId('admin-service-descriptors-error')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J35b: the sentence on screen is the one the endpoint returns', async ({ page }) => {
  await openServiceDescriptors(page);

  const refused = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { credentials: 'include' });
    return { status: response.status, body: (await response.json()) as { error?: string } };
  }, DESCRIPTORS_ENDPOINT);

  // 501, not 200-with-rows and not 403. With the permission held, this is the
  // deployment's own answer about its own capability.
  expect(
    refused.status,
    'the listing must refuse rather than answer with invented rows',
  ).toBe(501);
  expect(refused.body.error, 'the refusal must carry a reason').toBeTruthy();

  // The page did not compose this text. If a future change hardcoded it here,
  // this comparison would still pass — until the server's wording moved, which
  // is exactly when a stale local copy becomes a lie.
  await expect(page.getByTestId('admin-service-descriptors-unavailable')).toContainText(
    refused.body.error ?? '__no reason returned__',
  );
});

adminTest('J35c: the listing renders no rows and offers no delete', async ({ page }) => {
  await openServiceDescriptors(page);
  await expect(page.getByTestId('admin-service-descriptors-unavailable')).toBeVisible();

  // The three rows the replaced handler invented, by the names it invented.
  for (const invented of ['2.0.0', 'Core platform service', 'Authentication service']) {
    await expect(page.getByText(invented, { exact: false })).toHaveCount(0);
  }

  // The reference page puts a delete icon on every row behind a
  // `window.confirm`. A control that cannot work is the thing this unit removes.
  await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
});

adminTest('J35d: both registration verbs are refused by the server', async ({ page }) => {
  await openServiceDescriptors(page);

  // Forged, not clicked — no control on the page issues these, which is the
  // point. A registration that reports success and stores nothing is worse than
  // a refusal: the operator points a provider at Elitea, sees it accepted, and
  // finds out it was never reachable when an agent fails to call its tools.
  const results = await page.evaluate(async (endpoint) => {
    const post = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e-forged-provider',
        service_location_url: 'https://provider.example.invalid/e2e',
        configuration: {},
        provided_toolkits: [],
      }),
    });
    const postBody = await post.text();
    const remove = await fetch(
      endpoint +
        '?provider_name=e2e-forged-provider&service_location_url=https://provider.example.invalid/e2e',
      { method: 'DELETE', credentials: 'include' },
    );
    return { post: post.status, postBody, remove: remove.status };
  }, REGISTER_ENDPOINT);

  expect(results.post, 'a registration must be refused, not accepted and discarded').toBe(501);
  expect(results.remove, 'a de-registration must be refused, not answered {"ok":true}').toBe(501);
  // Not `{"ok": true}` — the exact body the dead handler returned.
  expect(results.postBody).not.toContain('"ok"');

  // And a reload still shows nothing registered: the forged POST did not land
  // somewhere the page would later read.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openServiceDescriptors(page);
  await expect(page.getByText('e2e-forged-provider')).toHaveCount(0);
  await expect(page.getByTestId('admin-service-descriptors-unavailable')).toBeVisible();
});

adminTest('J35e: the Configuration section says the same thing', async ({ page }) => {
  // An operator can reach this subject from two places. In the reference SPA the
  // reachable one is actually the Configuration section — its standalone page
  // has no route and nothing imports it. Both must agree.
  //
  // The navigation comes first because `page.evaluate` runs in the document's
  // own context: on `about:blank` a relative URL has no base to resolve against.
  await page.goto(BASE_URL + '/admin/app/configuration', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Resources/ })).toBeVisible({ timeout: 20_000 });

  const pageReason = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { credentials: 'include' });
    return ((await response.json()) as { error?: string }).error ?? '';
  }, DESCRIPTORS_ENDPOINT);
  expect(pageReason).not.toBe('');

  await page.getByRole('button', { name: /Service Descriptors/ }).click();

  const notice = page.getByTestId('admin-configuration-unavailable');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(pageReason);
});
