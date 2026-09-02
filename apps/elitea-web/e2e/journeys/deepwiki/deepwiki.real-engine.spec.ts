import { expect, test } from '@playwright/test';
import { SEEDED, listKeys, openDeepWiki, readObject, replaceEditorText } from './helpers';

/**
 * DWIKI-014 — the REAL analysis engine, end to end through the product
 * (ADR-0023 acceptance).
 *
 * Runs in the `deepwiki-real-engine` project only, against the standalone
 * stack brought up with deploy/docker-compose.deepwiki-real-engine.yml: the
 * `-engine` image with the legacy runner behind the Go host, a git daemon
 * serving the seeded repository, and the deterministic LLM stub behind the
 * gateway. Nothing is canned on the wiki side: the engine clones, indexes,
 * plans a structure, writes pages, and the host composes and uploads.
 *
 * What is asserted is the pipeline, not the prose: the run completes, a
 * manifest and at least one page land under the engine's own wiki id, the
 * page is markdown the browser renders, and the wiki chat answers over the
 * generated index.
 */
const GENERATION_TIMEOUT = 15 * 60 * 1000;
const TOOLKIT_PATH = `/app/deepwiki/${SEEDED.mutable.toolkitId}`;

/**
 * The models the engine asks the platform for. The seed names `gpt-4o-mini`
 * (a real-world default the fixture runner never reads); this stack serves
 * the mock's models, seeded into the toolkit's project by
 * scripts/deepwiki-real-engine.sh (SEED_EXTRA_PROJECTS). They are written
 * through the product's own settings panel, the way an operator points a
 * toolkit at a model — `llm_model` reaches the facade as the chat model and
 * `embedding_model` reaches the engine through the host.
 */
const LLM_MODEL = process.env.E2E_REAL_ENGINE_LLM_MODEL ?? 'vllm/E2E-MOCK-MODEL';
const EMBEDDING_MODEL = process.env.E2E_REAL_ENGINE_EMBEDDING_MODEL ?? 'vllm/E2E-MOCK-EMBEDDING';

test.describe.configure({ mode: 'serial' });

test('DWIKI-014: the real engine generates a wiki that lands and renders', async ({ page }) => {
  test.setTimeout(GENERATION_TIMEOUT + 60_000);
  await openDeepWiki(page, TOOLKIT_PATH);

  // A wiki left by an earlier run (a kept stack) is deleted through the
  // product first, so what is asserted below is THIS run's output only.
  if ((await listKeys(page, SEEDED.mutable.wikiId)).length > 0) {
    await page.getByTestId('wiki-delete').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(page.getByText(/No wiki has been generated/i)).toBeVisible({
      timeout: 30_000,
    });
    expect(await listKeys(page, SEEDED.mutable.wikiId)).toEqual([]);
  }

  // Point the toolkit at the models this stack serves, through the panel.
  await page.getByTestId('wiki-settings-toggle').click();
  await expect(page.getByTestId('wiki-settings-panel')).toBeVisible();
  await replaceEditorText(
    page,
    JSON.stringify({
      repository: SEEDED.mutable.repository,
      branch: 'main',
      llm_model: LLM_MODEL,
      embedding_model: EMBEDDING_MODEL,
      code_toolkit: 9010,
    }),
  );
  await expect(page.getByTestId('wiki-settings-save')).toBeEnabled();
  await page.getByTestId('wiki-settings-save').click();
  await expect(page.getByTestId('wiki-settings-saved')).toBeVisible({
    timeout: 15_000,
  });
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByTestId('wiki-generate').click();
  await expect(page.getByTestId('wiki-generation-status')).toHaveAttribute('data-status', 'running', {
    timeout: 30_000,
  });
  // Poll the status so a FAILED run fails the test at once, with the log,
  // instead of waiting out the whole generation budget.
  await expect
    .poll(async () => page.getByTestId('wiki-generation-status').getAttribute('data-status'), {
      timeout: GENERATION_TIMEOUT,
      intervals: [5_000],
      message: 'the generation must complete',
    })
    .not.toMatch(/^(running|queued|pending)$/);
  const status = await page.getByTestId('wiki-generation-status').getAttribute('data-status');
  const log = await page.getByTestId('wiki-generation-log').innerText();
  expect(status, `generation ended in '${status}':\n${log}`).toBe('completed');
  expect(log, 'the host uploaded what the engine produced').toMatch(/Uploaded \d+ wiki objects/);

  const keys = await listKeys(page, SEEDED.mutable.wikiId);
  const manifests = keys.filter((key) => /\/wiki_manifest_[^/]+\.json$/.test(key));
  const pages = keys.filter((key) => key.includes('/wiki_pages/') && key.endsWith('.md'));
  expect(manifests, 'exactly one manifest for the generated version').toHaveLength(1);
  expect(pages.length, 'the engine wrote at least one page').toBeGreaterThan(0);
  expect(keys).toContain(`${SEEDED.mutable.wikiId}/repository_context.txt`);

  const manifest = await readObject(page, manifests[0] as string);
  expect(manifest.status).toBe(200);
  const parsed = JSON.parse(manifest.text) as {
    wiki_id?: string;
    pages?: string[];
  };
  expect(parsed.wiki_id).toBe(SEEDED.mutable.wikiId);
  expect(parsed.pages?.length).toBe(pages.length);

  const first = await readObject(page, pages[0] as string);
  expect(first.status).toBe(200);
  expect(first.text.trim().length, 'a page carries content, not an empty file').toBeGreaterThan(20);

  // The browser reads what landed: the generated wiki is listed and its first
  // page renders as markdown.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The list shows each page under its file name; the manifest entry (the
  // engine's absolute key) is the secondary line.
  const firstLabel = (pages[0]?.split('/').pop() ?? '').replace(/\.md$/i, '');
  const firstEntry = page.getByRole('button', { name: new RegExp(`^${firstLabel}\\b`) }).first();
  await expect(firstEntry).toBeVisible({ timeout: 30_000 });
  await firstEntry.click();
  await expect(page.getByTestId('wiki-page-error')).toHaveCount(0);
  await expect(page.getByTestId('wiki-page-content')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('wiki-page-content').locator('h1, h2, p').first()).toBeVisible();
});

test('DWIKI-014b: the wiki chat answers over the generated index', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await openDeepWiki(page, TOOLKIT_PATH);
  await page.getByRole('button', { name: 'Ask about this repository' }).click();
  const drawer = page.getByTestId('wiki-chat-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('Ask about this repository').fill('What does this repository do?');
  await drawer.getByRole('button', { name: 'Send' }).click();
  // The stub's answer is canned; what is proven is that the engine retrieved
  // over the index it built and the answer streamed back through the host.
  await expect(drawer.getByTestId('wiki-chat-answer').last()).toContainText(/\S{10,}/, { timeout: 4 * 60 * 1000 });
  await expect(drawer.getByTestId('wiki-chat-error')).toHaveCount(0);
});
