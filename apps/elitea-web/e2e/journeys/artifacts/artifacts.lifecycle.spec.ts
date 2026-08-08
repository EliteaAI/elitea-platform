/**
 * Journey 20: Artifacts: create bucket → upload → preview → download → ZIP multi-download → delete (JRNY-020)
 *
 * Spec §8.5 acceptance (from parity/manifest/artifacts.json JRNY-020).
 * Acceptance: each step behaves as in the baseline including the direct storage upload;
 * errors at any step are surfaced without corrupting the bucket view.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATE OF THIS JOURNEY (verified against the running E2E stack, 2026-08-08)
 *
 * All five tests pass on chromium and webkit. J20b-J20e carried
 * `test.fail()` until issue #138 was fixed: the client addressed the LEGACY
 * Pylon artifact URLs (`/artifacts/s3/...`, `/artifacts/artifact/default/...`,
 * `/artifacts/buckets/default/{projectId}`) while elitea-main serves only
 * `/api/v2/artifacts/{buckets,objects,grants}` (`mountArtifactRoutes`,
 * router.go:255-311), so no bucket, file table, preview, download or ZIP was
 * reachable at all; and a collapsing `FormHelperText` on the create-bucket
 * form moved the button row 22.9 px on the blur that the first click itself
 * produced, so that click never landed.
 *
 * Artifacts are ENABLED in the E2E stack — `ELITEA_ARTIFACTS_ENABLED` is only
 * read at `services/elitea-main/cmd/elitea-main/main.go:103` (`!= "false"`)
 * and `deploy/docker-compose.e2e-standalone.yml` never sets it, so
 * elitea-main boots with a live rustfs-backed object store.
 *
 * NOT ASSERTED — JRNY-020's final "delete" step. DELETE
 * /api/v2/artifacts/buckets/... and DELETE .../objects/... return 403 for
 * BOTH personas, because `apps/elitea-web/scripts/e2e-stack.sh` seeds only
 * `configuration.artifacts.artifacts.{create,view}` and
 * `configuration.artifacts.buckets.{create,view}` (lines 210-213) — never
 * `.delete` or `.edit`, which `router.go:259-262` requires. A delete test
 * here would assert an environment gap, not app behaviour; the fix is to add
 * the two permissions to the seed, at which point the delete step belongs in
 * J20d. This is an E2E-stack defect, not an app defect.
 *
 * NO CLEANUP IS POSSIBLE from this spec for the same reason, so the two
 * buckets it touches use FIXED names and are reused across runs rather than
 * accumulating one per run.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import JSZip from 'jszip';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';

/**
 * Fixed, reused bucket names. `AUTOTEST_PREFIX` ('autotest_') is deliberately
 * NOT used: `CreateBucket.tsx:17`'s `BUCKET_NAME_PATTERN`
 * (/^[a-zA-Z][a-zA-Z0-9-]*$/) rejects the underscore, which is what left the
 * previous revision of this spec clicking a permanently-disabled submit
 * button for 30 s. `autotest-` keeps the sweepable prefix within the S3 naming
 * rules the app (correctly) enforces. `-art` suffix per the run convention.
 */
const READ_BUCKET = 'autotest-j20-art';
const FORM_BUCKET = 'autotest-j20-form-art';
const FILE_NAME = 'j20-art.txt';
/** 25 bytes — the table must render "25 B", a value only the backend can supply. */
const FILE_BODY = 'E2E artifact test content';
const SECOND_FILE_NAME = 'j20-second-art.txt';
const SECOND_FILE_BODY = 'second artifact for the ZIP';

/** The project the app itself selected, read from the store the app writes. */
async function selectedProjectId(page: Page): Promise<string> {
  const id = await page.evaluate(() => localStorage.getItem('el.project.id'));
  expect(id, 'app-shell must have persisted a selected project').not.toBeNull();
  return id as string;
}

/** Idempotent backend fixture: bucket + two objects with known bytes. */
async function seedBucketWithFiles(request: APIRequestContext, projectId: string): Promise<void> {
  // 200 on create, 409 when a previous run already created it — both mean
  // "the bucket exists", which is the only postcondition this helper promises.
  const created = await request.post(`/api/v2/artifacts/buckets/${projectId}`, {
    data: { name: READ_BUCKET },
  });
  expect([200, 201, 409]).toContain(created.status());

  // `overwrite=true` (objects.go:301) so a re-run replaces the object instead
  // of 409-ing — this spec cannot delete anything (see the header note).
  for (const [name, body] of [[FILE_NAME, FILE_BODY], [SECOND_FILE_NAME, SECOND_FILE_BODY]] as const) {
    const uploaded = await request.post(`/api/v2/artifacts/objects/${projectId}/${READ_BUCKET}?overwrite=true`, {
      multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from(body) } },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    expect((await uploaded.json()).size_bytes).toBe(body.length);
  }
}

/** Drain a Playwright download into a Buffer. */
async function readDownload(download: { createReadStream: () => Promise<NodeJS.ReadableStream> }): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test.describe('J20 artifacts lifecycle', () => {
  /**
   * The create-bucket screen is a real form, not scaffolding.
   *
   * Every assertion here is something a stub page cannot satisfy: the Name
   * field arrives PREFILLED with `new-bucket` (CreateBucket.tsx:32), and the
   * live validator (CreateBucket.tsx:19-26) both disables submit and prints
   * its exact message for a name that violates the S3 bucket-name rule.
   * Deliberately no `getByRole('heading')` anywhere — a bare heading is
   * precisely what a stub renders.
   */
  test('J20a: the create-bucket form is real — prefilled name and live validation', async ({ page }) => {
    await page.goto(BASE_URL + '/app/artifacts');
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });
    await checkA11y(page);

    // Production affordance: BucketSidebar's icon button (BucketSidebar.tsx:58).
    await page.getByRole('button', { name: /^create bucket$/i }).first().click();
    await page.waitForURL('**/artifacts/create-bucket**', { timeout: 15_000 });

    const name = page.getByRole('textbox', { name: /^name$/i });
    await expect(name).toHaveValue('new-bucket');
    await expect(name).toHaveAttribute('maxlength', '56');

    const submit = page.getByRole('button', { name: /^create bucket$/i });
    await expect(submit).toBeEnabled();

    // A name that breaks the pattern must disable submit AND print the
    // validator's exact sentence. A stub renders neither.
    await name.fill('9-starts-with-a-digit');
    await name.blur();
    await expect(page.getByText('Start with a letter and use only letters, numbers, and hyphens.')).toBeVisible();
    await expect(submit).toBeDisabled();

    // …and recovering restores it, proving the validator is live, not a
    // one-shot render.
    await name.fill(FORM_BUCKET);
    await expect(submit).toBeEnabled();
    await checkA11y(page);
  });

  /**
   * A single click on "Create bucket" must submit the form.
   *
   * The regression this guards: `CreateBucket.tsx`'s `helperText` used to
   * become '' on blur, collapsing FormHelperText and moving the button row up
   * 22.9 px (measured: y=204.03 -> y=181.13). The user's very first click
   * after typing IS the blur, so mousedown landed on the button and mouseup
   * 23 px below it — no `click` event, no submit, no feedback (#138).
   */
  test('J20b: one click on Create bucket submits the form', async ({ page, request }) => {
    await page.goto(BASE_URL + '/app/artifacts');
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });
    const projectId = await selectedProjectId(page);

    await page.getByRole('button', { name: /^create bucket$/i }).first().click();
    await page.waitForURL('**/artifacts/create-bucket**', { timeout: 15_000 });

    const name = page.getByRole('textbox', { name: /^name$/i });
    await name.fill(FORM_BUCKET);

    // Exactly one click — the whole point of the test. No blur() first.
    const submitted = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().endsWith(`/api/v2/artifacts/buckets/${projectId}`),
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /^create bucket$/i }).click();
    await submitted;

    // Backend-derived confirmation: the bucket is in the API's own list.
    const listed = await request.get(`/api/v2/artifacts/buckets/${projectId}`);
    expect(listed.status()).toBe(200);
    expect((await listed.json()).buckets.map((b: { name: string }) => b.name)).toContain(FORM_BUCKET);
  });

  /**
   * The bucket sidebar must list the buckets the backend actually holds.
   *
   * The assertions are backend-derived on purpose: a bucket name that only
   * exists because this test POSTed it, addressed through the row's own
   * `aria-label="Delete <name>"` (BucketSidebar.tsx). A stub page cannot
   * produce either. Before #138 this listed nothing at all — the client asked
   * `/artifacts/s3/?project_id=…` (404) and
   * `/artifacts/buckets/default/{projectId}` (403, the literal `default`
   * eaten as `{projectID}`).
   */
  test('J20c: the sidebar lists a bucket that exists on the backend', async ({ page, request }) => {
    await page.goto(BASE_URL + '/app/artifacts');
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });
    const projectId = await selectedProjectId(page);
    await seedBucketWithFiles(request, projectId);

    await page.reload();
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: `Delete ${READ_BUCKET}`, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `Pin ${READ_BUCKET}`, exact: true })).toBeVisible();
    // Symptom check, kept last so it never masks the two assertions above.
    await expect(page.getByText('Failed to load buckets.')).toHaveCount(0);
  });

  /**
   * Open the bucket, see the uploaded file with its real size, download it,
   * and get the exact bytes back.
   *
   * The object is seeded through the API here; the UI is only asked to READ
   * it, which is the weakest possible form of this assertion. "25 B" is
   * `formatArtifactSize` (entities/artifact/model/selectors.ts:11) applied to
   * the backend's own `size_bytes`, and the download assertion compares the
   * file's real content — neither is renderable by a stub.
   */
  test('J20d: the file table shows the real size and Download returns the real bytes', async ({ page, request }) => {
    await page.goto(BASE_URL + '/app/artifacts');
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });
    const projectId = await selectedProjectId(page);
    await seedBucketWithFiles(request, projectId);

    await page.goto(`${BASE_URL}/app/artifacts?bucket=${READ_BUCKET}`);
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });

    // The row itself, addressed by the file's own name.
    const row = page.getByRole('row').filter({ hasText: FILE_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(`${FILE_BODY.length} B`);

    // Preview pane opens on the file's own preview affordance
    // (ArtifactTable.tsx:280) and renders the file's actual text.
    await page.getByRole('button', { name: `Preview ${FILE_NAME}`, exact: true }).click();
    await expect(page.getByText(FILE_BODY)).toBeVisible({ timeout: 15_000 });
    await checkA11y(page);

    // Download must deliver the exact bytes that were uploaded.
    await page.goBack();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: `Download ${FILE_NAME}`, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(FILE_NAME);
    expect((await readDownload(download)).toString()).toBe(FILE_BODY);
  });

  /**
   * "Download selected" over a multi-select must produce a real ZIP whose
   * entries are the real objects.
   *
   * The ZIP is assembled client-side by `useZipDownload` (jszip), so the
   * archive is unzipped here and its ENTRY NAMES and CONTENT are compared
   * against the bytes this test uploaded — a stub cannot fabricate either,
   * and the archive name `<bucket>.zip` (useZipDownload.ts:42) is the
   * backend's own bucket name.
   */
  test('J20e: Download selected produces a ZIP containing the real objects', async ({ page, request }) => {
    await page.goto(BASE_URL + '/app/artifacts');
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });
    const projectId = await selectedProjectId(page);
    await seedBucketWithFiles(request, projectId);

    await page.goto(`${BASE_URL}/app/artifacts?bucket=${READ_BUCKET}`);
    await page.waitForURL('**/artifacts**', { timeout: 15_000 });

    await expect(page.getByRole('row').filter({ hasText: FILE_NAME })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: 'Select all artifacts' }).check();

    const [zip] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download selected', exact: true }).click(),
    ]);
    expect(zip.suggestedFilename()).toBe(`${READ_BUCKET}.zip`);

    const archive = await JSZip.loadAsync(await readDownload(zip));
    expect(Object.keys(archive.files).sort()).toEqual([FILE_NAME, SECOND_FILE_NAME].sort());
    expect(await archive.file(FILE_NAME)!.async('string')).toBe(FILE_BODY);
    expect(await archive.file(SECOND_FILE_NAME)!.async('string')).toBe(SECOND_FILE_BODY);
  });
});
