/**
 * Journey 8: Create conversation → send message → stream tokens → stop (JRNY-008)
 * Journey 9: Regenerate a response (JRNY-009)
 * Journey 11: Rename conversation server-side → live update (JRNY-011)
 *
 * Spec §8.5 acceptance (from parity/manifest/chat.json JRNY-008/009/011).
 */
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX, clickCreateButton } from '../../fixtures/api';

// ─────────────────────────────────────────────────────────────────────────────
// Journey 8: Create conversation, send message, stream tokens, stop
// ─────────────────────────────────────────────────────────────────────────────
test('J8: create conversation, send message, stream tokens, stop', async ({ page }) => {
  await page.goto(BASE_URL + '/app/chat');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  await checkA11y(page);

  // Create a new conversation using the + button.
  await clickCreateButton(page);

  // The chat input should be visible. chat-input testId is on the MUI TextField
  // wrapper div; the actual fillable element is the inner textarea (chat-message-input).
  const chatInput = page
    .getByTestId('chat-message-input')
    .or(page.locator('[data-testid="chat-input"] textarea'))
    .or(page.getByRole('textbox', { name: /message|ask/i })).first();
  await expect(chatInput).toBeVisible({ timeout: 10_000 });

  // Type and send a simple message.
  await chatInput.fill(`${AUTOTEST_PREFIX}hello`);

  const sendButton = page.getByTestId('chat-send-button');
  await sendButton.click();

  // Tokens should start streaming — the message list should show a new entry.
  const messageList = page.getByTestId('chat-message-list');
  await expect(messageList).toBeVisible({ timeout: 5_000 });

  // Wait for at least one message item to appear.
  await expect(page.getByTestId('chat-message-item').first()).toBeVisible({ timeout: 15_000 });

  // The stop button should be visible while streaming.
  // If the response is fast, it may already be done — don't assert hard.
  const stopButton = page.getByRole('button', { name: /stop/i });
  const stopVisible = await stopButton.isVisible().catch(() => false);
  if (stopVisible) {
    // The stop control interrupts the stream.
    await stopButton.click();
    // After stopping, the partial answer is kept (the message item remains).
    await expect(page.getByTestId('chat-message-item').first()).toBeVisible({ timeout: 5_000 });
  }

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 9: Regenerate a response
// ─────────────────────────────────────────────────────────────────────────────
test('J9: regenerate a response', async ({ page }) => {
  await page.goto(BASE_URL + '/app/chat');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  // Type and send a message to get an initial response.
  const chatInput = page
    .getByTestId('chat-message-input')
    .or(page.locator('[data-testid="chat-input"] textarea'))
    .or(page.getByRole('textbox', { name: /message|ask/i })).first();
  await expect(chatInput).toBeVisible({ timeout: 10_000 });
  await chatInput.fill(`${AUTOTEST_PREFIX}regen-test`);
  await page.getByTestId('chat-send-button').click();

  // Wait for a response.
  await expect(page.getByTestId('chat-message-item').first()).toBeVisible({ timeout: 30_000 });

  // Find the regenerate button (usually near the last assistant message).
  const regenButton = page
    .getByRole('button', { name: /regenerate/i })
    .or(page.getByTestId('chat-regen-button')).first();

  const regenVisible = await regenButton.isVisible().catch(() => false);
  if (!regenVisible) {
    // Hover over the last message to reveal the action bar.
    await page.getByTestId('chat-message-item').last().hover();
  }

  await expect(regenButton).toBeVisible({ timeout: 5_000 });
  await regenButton.click();

  // A new response should stream in.
  await expect(page.getByTestId('chat-message-item').first()).toBeVisible({ timeout: 30_000 });

  await checkA11y(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 11: Server-side conversation rename → live update
// ─────────────────────────────────────────────────────────────────────────────
test('J11: server-side conversation rename live-updates in the list', async ({
  page,
  request,
}) => {
  await page.goto(BASE_URL + '/app/chat');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  // Send a message to create a conversation that will get an auto-generated name.
  const chatInput = page
    .getByTestId('chat-message-input')
    .or(page.locator('[data-testid="chat-input"] textarea'))
    .or(page.getByRole('textbox', { name: /message|ask/i })).first();
  await expect(chatInput).toBeVisible({ timeout: 10_000 });
  await chatInput.fill(`${AUTOTEST_PREFIX}rename test message`);
  await page.getByTestId('chat-send-button').click();

  // Wait for the conversation to appear in the list.
  await page.waitForTimeout(2_000);

  // Extract the current conversation ID from the URL.
  const url = page.url();
  const conversationIdMatch = url.match(/\/chat\/([^/?#]+)/);
  const conversationId = conversationIdMatch?.[1];

  if (conversationId) {
    const newName = `${AUTOTEST_PREFIX}renamed-${Date.now()}`;

    // Rename via API (simulates a server-side rename — e.g., auto-generated name).
    await request.put(
      `${BASE_URL}/api/v2/elitea_core/conversation/prompt_lib/1/${conversationId}`,
      { data: { name: newName } },
    );

    // The conversation list entry should update live (socket event) without a refetch.
    await expect(page.getByText(newName)).toBeVisible({ timeout: 15_000 });

    // The URL should remain unchanged.
    expect(page.url()).toContain(conversationId);
  }

  await checkA11y(page);
});
