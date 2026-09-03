/**
 * DWIKI-012 — the wiki chat, through the facade to the provider's `ask`, and
 * DWIKI-012b, the same round trip in research mode through `deep_research`.
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
import { expect, test } from '@playwright/test';

import { STORAGE_STATE } from '../../../playwright.config';
import { SEEDED, openDeepWiki } from './helpers';

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
});
