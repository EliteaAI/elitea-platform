import { test as adminTest, expect } from '@playwright/test';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

/**
 * DWIKI-013 — the provider is admitted at boot (ADR-0023 decision 6, H4a).
 *
 * Provider-backed, so it runs in the `deepwiki-stack` project only: the
 * standalone stack composes the facade with a public project
 * (ELITEA_AI_PROJECT_ID) and the Go host behind it, and the facade
 * registers the host's descriptor into the admission plane at boot and
 * keeps its health projection current. The E2E stack has no public project,
 * so registration is skipped there by design and this journey has nothing
 * to look at.
 *
 * What is asserted is the whole chain, from the ADMIN's side: the listing
 * the administration surface answers carries the provider the facade
 * registered — its own name from its own descriptor, the facade's target as
 * the origin, `healthy: true` from a probe inside the freshness window — and
 * the Service Descriptors page renders that row.
 */
adminTest.use({ storageState: STORAGE_STATE.admin });

const DESCRIPTORS_ENDPOINT = '/api/v2/elitea_core/admin/administration';

interface DescriptorRow {
  project_id?: number;
  provider_name?: string;
  service_location_url?: string;
  healthy?: boolean | null;
  status?: string;
  published_manifest_digest?: string | null;
}

adminTest('DWIKI-013: the facade registered the provider at boot, and the admin sees it healthy', async ({ page }) => {
  await page.goto(BASE_URL + '/admin/app/service-descriptors', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Service Descriptors' })).toBeVisible({ timeout: 20_000 });

  // The facade probes on an interval; the first probe runs at its boot, so
  // the row is there before any browser could be. Polled anyway, because a
  // stack that just came up may be inside its first minute.
  let wikis: DescriptorRow | undefined;
  await expect
    .poll(
      async () => {
        const listing = await page.evaluate(async (endpoint) => {
          const response = await fetch(endpoint, { credentials: 'include' });
          return { status: response.status, body: (await response.json()) as { rows?: DescriptorRow[] } };
        }, DESCRIPTORS_ENDPOINT);
        expect(listing.status, 'the listing must answer from storage (a 501 means no admission plane)').toBe(200);
        wikis = (listing.body.rows ?? []).find((row) => row.provider_name === 'wikis');
        return wikis?.healthy ?? null;
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(true);

  expect(wikis?.service_location_url, 'the origin is the facade\'s target, as registered').toBe('https://elitea-deepwiki:8080');
  expect(wikis?.status, 'admission is recorded, not in force, until a policy overlay exists').toBe('inactive');
  expect(wikis?.published_manifest_digest, 'the manifest was published').toMatch(/^[0-9a-f]{64}$/);

  // The page renders the registered row — with no "unavailable" notice.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid', { name: 'Registered service descriptors' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('admin-service-descriptors-unavailable')).toHaveCount(0);
  await expect(page.getByRole('grid', { name: 'Registered service descriptors' }).getByText('wikis', { exact: true })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Registered service descriptors' }).getByText('https://elitea-deepwiki:8080', { exact: false })).toBeVisible();
});
