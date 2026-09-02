/**
 * DWIKI-007 / 008 / 009 — the journeys that change ONE page of the read-only
 * wiki (toolkit 9001) and put it back.
 *
 * The three LLM-side calls the quick fix makes are answered at the browser
 * edge (`page.route`): this stack runs no LLM gateway, so
 * `POST /elitea_core/predict_llm/…` would answer 503, and the two capability
 * reads live behind ELITEA_CONFIGURATIONS_ENABLED, which the stack leaves
 * off. What the journey PROVES is everything on this side of the model: the
 * diagram fails in a real browser, the fix is offered, the diff is shown, the
 * accepted page is saved through the artifact API with `overwrite=true`, the
 * re-rendered diagram parses, and undo saves the original back. The model's
 * output itself is the one stated assumption.
 */
import { expect, test, type Page } from '@playwright/test';

import { STORAGE_STATE } from '../../../playwright.config';
import { SEEDED, objectUrl, openDeepWiki, readObject, replaceEditorText } from './helpers';

const TOOLKIT_PATH = `/app/deepwiki/${SEEDED.readOnly.toolkitId}`;
const BROKEN_KEY = `${SEEDED.readOnly.wikiId}/${SEEDED.readOnly.brokenPage}`;
const ROUTER_KEY = `${SEEDED.readOnly.wikiId}/${SEEDED.readOnly.page}`;
const FIXED = 'graph TD\n  A[Client] --> B[Router]';

async function stubQuickFixModel(page: Page): Promise<void> {
  await page.route(`**/api/v2/configurations/models/${SEEDED.projectId}**`, (route) =>
    route.fulfill({
      json: { items: [], low_tier_default_model_name: 'e2e-small', low_tier_default_model_project_id: SEEDED.projectId },
    }),
  );
  await page.route(`**/api/v2/configurations/configurations/${SEEDED.projectId}**`, (route) =>
    route.fulfill({ json: { items: [{ data: { key: 'MERMAID_QUICK_FIX', prompt: 'Repair this diagram.' } }] } }),
  );
  await page.route(`**/api/v2/elitea_core/predict_llm/prompt_lib/${SEEDED.projectId}`, (route) =>
    route.fulfill({ json: { result: { output: `\`\`\`mermaid\n${FIXED}\n\`\`\`` } } }),
  );
}

/**
 * The seeded page with the broken diagram, as the journey needs it. A run
 * that failed between accept and undo leaves the REPAIRED text in the
 * bucket, and every later run would fail its precondition on someone else's
 * leftovers — so the broken block is put back first, through the same
 * artifact route the reader saves with.
 */
async function ensureBrokenPage(page: Page): Promise<string> {
  const current = await readObject(page, BROKEN_KEY);
  expect(current.status).toBe(200);
  if (current.text.includes('A[Client] -->\n')) return current.text;
  const restored = current.text.replace(FIXED, 'graph TD\n  A[Client] -->');
  expect(restored).not.toBe(current.text);
  const response = await page.request.post(objectUrl('').replace(/\/$/, '') + '?overwrite=true', {
    multipart: { file: { name: BROKEN_KEY, mimeType: 'text/markdown', buffer: Buffer.from(restored) } },
  });
  expect(response.ok(), `restoring the broken page: ${response.status()}`).toBe(true);
  return restored;
}

async function openBrokenPage(page: Page): Promise<void> {
  await openDeepWiki(page, TOOLKIT_PATH);
  await page.getByText(SEEDED.readOnly.brokenPage).click();
  await expect(page.getByTestId('wiki-page-reader')).toBeVisible({ timeout: 20_000 });
}

test.describe('DeepWiki page editing', () => {
  // mermaid renders twice in a real browser and each save round-trips the
  // artifact API: longer than Playwright's 30s default.
  test.setTimeout(120_000);

  test.use({ storageState: STORAGE_STATE.member });

  test('DWIKI-007 + 008: a diagram that fails to render offers a quick fix; the accepted fix is saved, and undone', async ({
    page,
  }) => {
    await stubQuickFixModel(page);
    const original = await ensureBrokenPage(page);
    expect(original).toContain('A[Client] -->\n');

    await openBrokenPage(page);
    // mermaid rejected the block in the browser, so the fix is on offer.
    const offer = page.getByTestId('canvas-mermaid-quick-fix');
    await expect(offer).toBeVisible({ timeout: 30_000 });

    await offer.click();
    const diff = page.getByTestId('wiki-fix-diff');
    await expect(diff).toBeVisible({ timeout: 20_000 });
    await expect(diff).toContainText('A[Client] --> B[Router]');

    await page.getByTestId('wiki-fix-accept').click();
    await expect(page.getByTestId('wiki-page-feedback')).toContainText('Diagram fixed and saved', { timeout: 20_000 });
    // Saved for real: the object in the bucket carries the repaired block.
    const repaired = await readObject(page, BROKEN_KEY);
    expect(repaired.text).toContain(FIXED);
    expect(repaired.text).toContain('After the diagram.');
    // And the repaired diagram parses, so the offer is gone.
    await expect(offer).toHaveCount(0, { timeout: 30_000 });

    await page.getByTestId('wiki-fix-undo').click();
    await expect(page.getByTestId('wiki-page-feedback')).toContainText('undone', { timeout: 20_000 });
    const restored = await readObject(page, BROKEN_KEY);
    expect(restored.text).toBe(original);
  });

  test('DWIKI-009: edited page markdown is saved back to the wiki', async ({ page }) => {
    const original = await readObject(page, ROUTER_KEY);
    expect(original.status).toBe(200);
    const marker = `Edited by DWIKI-009 at ${Date.now()}`;

    await openDeepWiki(page, TOOLKIT_PATH);
    await page.getByText(SEEDED.readOnly.page).click();
    await expect(page.getByTestId('wiki-page-content').locator('h1')).toHaveText(SEEDED.readOnly.pageHeading);

    await page.getByTestId('wiki-page-edit').click();
    await expect(page.getByTestId('wiki-page-editor')).toBeVisible();
    await replaceEditorText(page, `${original.text.trimEnd()}\n\n${marker}\n`);
    await page.getByTestId('wiki-page-editor-save').click();
    await expect(page.getByTestId('wiki-page-editor')).toHaveCount(0, { timeout: 20_000 });

    // On screen and in the bucket, without a reload.
    await expect(page.getByTestId('wiki-page-content')).toContainText(marker, { timeout: 20_000 });
    const saved = await readObject(page, ROUTER_KEY);
    expect(saved.text).toContain(marker);
    expect(saved.text).toContain(`# ${SEEDED.readOnly.pageHeading}`);

    // Put back, through the same editor, so the read-only fixture stays read-only.
    await page.getByTestId('wiki-page-edit').click();
    await replaceEditorText(page, original.text);
    await page.getByTestId('wiki-page-editor-save').click();
    await expect(page.getByTestId('wiki-page-editor')).toHaveCount(0, { timeout: 20_000 });
    expect((await readObject(page, ROUTER_KEY)).text).toBe(original.text);
  });
});
