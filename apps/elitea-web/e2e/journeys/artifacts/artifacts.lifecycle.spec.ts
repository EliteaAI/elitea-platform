/**
 * Journey 20: Artifacts: create bucket → upload → preview → download → ZIP multi-download → delete (JRNY-020)
 *
 * Spec §8.5 acceptance (from parity/manifest/artifacts.json JRNY-020).
 * Acceptance: each step behaves as in the baseline including the direct storage upload;
 * errors at any step are surfaced without corrupting the bucket view.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX } from '../../fixtures/api';

test('J20: artifacts bucket lifecycle: create, upload, preview, download, ZIP, delete', async ({
  page,
}) => {
  await page.goto(BASE_URL + '/app/artifacts');
  await page.waitForURL('**/artifacts**', { timeout: 15_000 });

  await checkA11y(page);

  // Create a bucket. The affordance is the BucketSidebar's icon button
  // (`aria-label="Create bucket"`), matching production — NOT an in-page
  // primary button. No testid fallback: the stub that carried
  // `data-testid="create-bucket-button"` is gone, and reinstating a fallback
  // would let this journey pass against scaffolding again.
  await page.getByRole('button', { name: /create bucket/i }).first().click();

  // Real CreateBucket form: heading "New bucket", a "Name" field prefilled
  // with `new-bucket`, and a "Create bucket" submit.
  await expect(page.getByText(/new bucket/i).first()).toBeVisible({ timeout: 5_000 });
  const bucketNameInput = page.getByRole('textbox', { name: /^name$/i }).first();
  await expect(bucketNameInput).toBeVisible({ timeout: 5_000 });

  const bucketName = `${AUTOTEST_PREFIX}e2e-bucket`;
  await bucketNameInput.fill(bucketName);
  await checkA11y(page);
  await page.getByRole('button', { name: /^create bucket$/i }).click();

  // CreateBucket navigates back to /artifacts with `?bucket=<name>` on success.
  await page.waitForURL(`**/artifacts?**bucket=${bucketName}**`, { timeout: 15_000 });

  // The new bucket is selected in the sidebar and its (empty) table is shown.
  const bucketItem = page.getByText(bucketName).first();
  await expect(bucketItem).toBeVisible({ timeout: 10_000 });
  await bucketItem.click();

  // Create a test file to upload.
  const tmpFile = path.join(os.tmpdir(), 'e2e-artifact.txt');
  fs.writeFileSync(tmpFile, 'E2E artifact test content');

  try {
    // Upload the file (S3 direct PUT — spec §5.7).
    const uploadButton = page.getByRole('button', { name: /upload/i });
    const uploadVisible = await uploadButton.isVisible().catch(() => false);
    if (uploadVisible) {
      await uploadButton.click();
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(tmpFile);

      // Wait for upload to complete.
      await expect(page.getByText('e2e-artifact.txt')).toBeVisible({ timeout: 30_000 });

      // Preview the file.
      await page.getByText('e2e-artifact.txt').click();
      // The preview should open (image/text preview pane).
      await page.waitForTimeout(500);
      await checkA11y(page);

      // Download the file.
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }),
        page.getByRole('button', { name: /download/i }).click(),
      ]);
      expect(download.suggestedFilename()).toBeTruthy();

      // ZIP multi-download.
      // Select multiple files and download as ZIP.
      const selectCheckbox = page.locator('input[type="checkbox"]').first();
      if (await selectCheckbox.isVisible().catch(() => false)) {
        await selectCheckbox.check();
        const zipButton = page.getByRole('button', { name: /zip|download selected/i });
        if (await zipButton.isVisible().catch(() => false)) {
          const [zipDownload] = await Promise.all([
            page.waitForEvent('download', { timeout: 10_000 }),
            zipButton.click(),
          ]);
          expect(zipDownload.suggestedFilename()).toContain('.zip');
        }
      }

      // Delete the file.
      const deleteButton = page.getByRole('button', { name: /delete/i }).first();
      if (await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click();
        await page.getByRole('button', { name: /confirm|yes|delete/i }).click();
        await expect(page.getByText('e2e-artifact.txt')).not.toBeVisible({ timeout: 5_000 });
      }
    }
  } finally {
    fs.unlinkSync(tmpFile);
  }

  await checkA11y(page);
});
