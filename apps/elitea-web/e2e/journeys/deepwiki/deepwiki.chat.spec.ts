/**
 * DWIKI-012 — the wiki chat, through the facade to the provider's `ask`;
 * DWIKI-012b, the same round trip in research mode through `deep_research`;
 * DWIKI-016, a wiki page attached to the question as context.
 *
 * The SPI has no token channel (#701): the answer arrives whole with the
 * completed invocation, so this asserts the round trip, the sources and the
 * research plan, not streaming.
 *
 * WHERE THESE RUN. `PROVIDER_BACKED_JOURNEYS` names this file, which puts it
 * in the `deepwiki-stack` project — but it does NOT take it out of the
 * ordinary ones: `chromium` and `webkit` ignore only the admission and
 * real-engine journeys, so both tests below also run against the E2E stack,
 * whose facade composes the same fixture runner. Anything asserted here must
 * therefore hold on both stacks; both currently answer from
 * `run/fixture.go`.
 */
import { expect, test, type Page } from '@playwright/test';

import { STORAGE_STATE } from '../../../playwright.config';
import { SEEDED, openDeepWiki } from './helpers';

/** Opens the drawer on the read-only wiki and returns it. */
async function openChatDrawer(page: Page) {
  await openDeepWiki(page, `/app/deepwiki/${SEEDED.readOnly.toolkitId}`);
  await page.getByRole('button', { name: 'Ask about this repository' }).click();
  const drawer = page.getByTestId('wiki-chat-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Asks one question and waits for the fixture's answer to land. */
async function ask(page: Page, question: string) {
  const drawer = page.getByTestId('wiki-chat-drawer');
  await drawer.getByPlaceholder('Ask about this repository').fill(question);
  await drawer.getByRole('button', { name: 'Send' }).click();
  await expect(drawer.getByTestId('wiki-chat-answer').last()).toContainText(
    `Fixture answer to: ${question}`,
    { timeout: 60_000 },
  );
}

test.describe('DeepWiki chat', () => {
  // A provider round trip through the facade, plus the fixture's paced steps:
  // longer than Playwright's 30s default, which killed a passing answer mid-poll.
  test.setTimeout(120_000);

  test.use({ storageState: STORAGE_STATE.member });

  test('DWIKI-012: the wiki chat answers a question about the wiki, with its sources', async ({ page }) => {
    await openDeepWiki(page, `/app/deepwiki/${SEEDED.readOnly.toolkitId}`);
    await page.getByRole('button', { name: 'Ask about this repository' }).click();
    const drawer = page.getByTestId('wiki-chat-drawer');
    await expect(drawer).toBeVisible();

    const question = 'Where do the wiki pages live?';
    await drawer.getByPlaceholder('Ask about this repository').fill(question);
    await drawer.getByRole('button', { name: 'Send' }).click();

    await expect(drawer.getByTestId('wiki-chat-answer').last()).toContainText(`Fixture answer to: ${question}`, {
      timeout: 60_000,
    });
    await expect(drawer.getByTestId('wiki-chat-messages')).toContainText('wiki_pages/overview/getting-started.md');
    await expect(drawer.getByTestId('wiki-chat-error')).toHaveCount(0);
  });

  test('DWIKI-012b: research mode shows the plan the run is working through, and its report', async ({
    page,
  }) => {
    // The research panel renders ONLY when a run has a plan, and renders
    // nothing when it has none — which is right for `ask` and looks exactly
    // like a panel that was never wired up. That is why this journey exists
    // and why the fixture runner publishes a `todo_update` event
    // (run/fixture.go `ResearchTodos`): without one, no end-to-end test can
    // tell the two apart.
    await openDeepWiki(page, `/app/deepwiki/${SEEDED.readOnly.toolkitId}`);
    await page.getByRole('button', { name: 'Ask about this repository' }).click();
    const drawer = page.getByTestId('wiki-chat-drawer');
    await expect(drawer).toBeVisible();

    // The mode picks the TOOL: `research` sends `deep_research`, and the
    // drawer polls that tool's own path. Asking in `ask` mode would answer
    // and produce no plan at all.
    await drawer.getByRole('button', { name: 'Research', exact: true }).click();

    const question = 'How is the wiki assembled?';
    await drawer.getByPlaceholder('Ask about this repository').fill(question);
    await drawer.getByRole('button', { name: 'Send' }).click();

    const todos = drawer.getByTestId('wiki-chat-todos');
    await expect(todos).toBeVisible({ timeout: 60_000 });
    // The three fixture steps, and the status vocabulary the panel translates.
    await expect(todos).toContainText('Plan the research');
    await expect(todos).toContainText('Read the relevant pages');
    await expect(todos).toContainText('Write the report');
    await expect(todos).toContainText('Done');
    await expect(todos).toContainText('In progress');
    await expect(todos).toContainText('Pending');

    // The plan is not the answer: the report has to land as well, or a run
    // that published a plan and then died would read as a success.
    await expect(drawer.getByTestId('wiki-chat-answer').last()).toContainText('Research report (general)', {
      timeout: 60_000,
    });
    await expect(drawer.getByTestId('wiki-chat-answer').last()).toContainText(`Question: ${question}`);
    await expect(drawer.getByTestId('wiki-chat-error')).toHaveCount(0);
  });

  test('DWIKI-016: a page attached as context reaches the invocation, resolved to its text', async ({
    page,
  }) => {
    /**
     * THE ONE ASSERTION THAT CAN TELL THE FEATURE FROM ITS PARTS. The picker
     * sends page IDS; the host resolves them against the pinned version's
     * manifest and prepends the page BODIES to the question. Every unit test
     * on either side of that can pass while the two are not joined — the
     * defect class this repository keeps meeting (#597).
     *
     * The fixture `ask` echoes the question it was handed
     * (`run/fixture.go::fixtureAsk`), so the answer is a verbatim window onto
     * what the engine would have received. The sentence asserted below exists
     * ONLY in the seeded page body (`scripts/e2e-stack.sh`, router.md) — the
     * browser never had it, so it can only have arrived by the server reading
     * that page.
     */
    await openDeepWiki(page, `/app/deepwiki/${SEEDED.readOnly.toolkitId}`);
    await page.getByRole('button', { name: 'Ask about this repository' }).click();
    const drawer = page.getByTestId('wiki-chat-drawer');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: 'Attach wiki pages' }).click();
    await page.getByText('architecture / router', { exact: true }).click();
    await page.keyboard.press('Escape');

    // The chip is the reader's own record of what the next question carries.
    await expect(drawer.getByTestId('wiki-chat-context-chips')).toContainText('architecture / router');

    const question = 'Which file assembles the router?';
    await drawer.getByPlaceholder('Ask about this repository').fill(question);
    await drawer.getByRole('button', { name: 'Send' }).click();

    const answer = drawer.getByTestId('wiki-chat-answer').last();
    // The RESOLVED page text, and the source header that frames it.
    await expect(answer).toContainText('The HTTP router is assembled in', { timeout: 60_000 });
    await expect(answer).toContainText('wiki_pages/architecture/router.md');
    // The question is still the question: context is PREPENDED, not
    // substituted, and the engine's `Current question: ` hand-off is what
    // keeps the two tellable apart in a transcript.
    await expect(answer).toContainText(`Current question: ${question}`);
    await expect(drawer.getByTestId('wiki-chat-error')).toHaveCount(0);
  });
});

/**
 * DWIKI-016 — the wiki chat's history is the SERVER'S, not this browser's.
 *
 * The drawer used to keep its conversation in `localStorage`, so it was gone
 * on another device, in another browser and on a cleared profile. Both turns
 * are now written by elitea-main — the question when the invoke is accepted,
 * the answer when the terminal poll is drained — into the ordinary tenant
 * chat tables.
 *
 * WHAT MAKES THIS A JOURNEY AND NOT A UNIT TEST. Three things have to line up
 * across two processes: the facade has to observe an invoke it only sees as a
 * proxy, it has to tee a poll the browser drains, and the drawer has to find
 * the conversation again through the ordinary chat listing with the right
 * filters. Every one of those has a unit test on each side, and none of those
 * tests can see the wiring — the defect class this repository keeps meeting
 * (#597).
 *
 * THE SECOND CONTEXT IS THE ASSERTION THAT MATTERS. A reload alone would pass
 * against the old localStorage drawer, because a reload keeps localStorage. It
 * is a fresh browser context — nothing carried over but the sign-in — that
 * tells "stored on the server" apart from "stored in this profile".
 */
test.describe('DeepWiki chat history', () => {
  test.setTimeout(180_000);

  test.use({ storageState: STORAGE_STATE.member });

  test('DWIKI-016: a wiki conversation survives a reload and a fresh browser', async ({
    page,
    browser,
  }) => {
    await openChatDrawer(page);

    // Two turns, so the transcript's ORDER is observable. One turn would pass
    // against a reader that returned the newest group and stopped.
    const stamp = Date.now();
    const first = `Where do the wiki pages live? ${stamp}`;
    const second = `And who writes them? ${stamp}`;
    await ask(page, first);
    await ask(page, second);

    /* ── the same browser, after a reload ── */
    await page.reload({ waitUntil: 'domcontentloaded' });
    let drawer = await openChatDrawer(page);
    await expect(drawer.getByText(first)).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByText(second)).toBeVisible();

    /* ── a fresh browser context: same user, nothing else carried over ── */
    const fresh = await browser.newContext({ storageState: STORAGE_STATE.member });
    try {
      const other = await fresh.newPage();
      await openDeepWiki(other, `/app/deepwiki/${SEEDED.readOnly.toolkitId}`);
      await other.getByRole('button', { name: 'Ask about this repository' }).click();
      const otherDrawer = other.getByTestId('wiki-chat-drawer');
      await expect(otherDrawer).toBeVisible();

      // The whole point: this profile has never held the conversation, so
      // anything on screen came off the server.
      await expect(otherDrawer.getByText(first)).toBeVisible({ timeout: 30_000 });
      await expect(otherDrawer.getByText(second)).toBeVisible();
      await expect(otherDrawer.getByTestId('wiki-chat-answer').first()).toContainText(
        `Fixture answer to: ${first}`,
      );
    } finally {
      await fresh.close();
    }

    /* ── "Clear" starts a NEW conversation; it does not erase the old one ── */
    drawer = page.getByTestId('wiki-chat-drawer');
    await drawer.getByRole('button', { name: 'Clear the conversation' }).click();
    await expect(drawer.getByText(first)).toHaveCount(0);

    // And the cleared conversation is STILL THERE. A "Clear" that deleted
    // tenant data would pass every assertion above and lose the history that
    // was the point of keeping.
    const origin = new URL(page.url()).origin;
    const stored = await page.request.get(
      `${origin}/api/v2/elitea_core/conversations/prompt_lib/${SEEDED.projectId}` +
        `?source=deepwiki&entity_name=toolkit&entity_meta_id=${SEEDED.readOnly.toolkitId}` +
        `&hidden=only&mine=true&limit=20`,
    );
    expect(stored.ok(), `listing wiki conversations: ${stored.status()}`).toBe(true);
    const body = (await stored.json()) as { rows?: { name?: string }[] };
    const names = (body.rows ?? []).map((row) => row.name ?? '');
    expect(names, 'the cleared conversation is still stored').toContain(first);
  });
});
