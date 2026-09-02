/**
 * DWIKI-012 — the wiki chat, through the facade to the provider's `ask`.
 *
 * The SPI has no token channel (#701): the answer arrives whole with the
 * completed invocation, so this asserts the round trip and the sources, not
 * streaming.
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
});
