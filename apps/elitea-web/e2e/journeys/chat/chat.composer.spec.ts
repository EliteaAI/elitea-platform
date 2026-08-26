/**
 * The composer takes keystrokes without throwing (regression for PR #597).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS AN E2E TEST AND NOT A UNIT TEST
 * ─────────────────────────────────────────────────────────────────────────────
 * `ChatBox` used to attach its own `ChatBoxHandle` with
 * `useImperativeHandle(chatInputRef, ...)` — the SAME ref it passes to
 * `<NewChatInput ref={chatInputRef}>`. The child's handle is attached first
 * and the parent's overwrote it on commit, so `chatInputRef.current` held
 * `{ onClear, mentionUser, stopAll }` and nothing else. Every keystroke then
 * threw out of the "/" and "~" mention hooks:
 *
 *   Uncaught TypeError: n.current?.getCursorPosition is not a function
 *       at onInputChange (chat-*.js)
 *
 * Chat was unusable in production while the whole unit suite was green: 2475
 * tests over `widgets/chat-box` + `features/chat-input` pass with the bug in
 * place, because the two halves are only ever mounted together by `ChatBox`
 * itself, and no unit test mounts it. This is the defect class where the
 * wiring between two individually-correct components is the bug, and the only
 * harness that can see it is one that renders the real composition root and
 * presses a key.
 *
 * The existing chat journeys press keys too — and passed with the bug — for
 * one reason: `locator.fill()` sets the value in a single DOM event, and
 * neither they nor Playwright fail a test on an uncaught page exception unless
 * something is listening for it. This spec listens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. No uncaught exception reaches the page while typing, ONE CHARACTER AT A
 *     TIME (`pressSequentially`, not `fill`) — the clobbered handle throws on
 *     the first keystroke, since `useSlashMention.onInputChange` calls
 *     `chatInput.current.getCursorPosition()` for any non-empty value, with no
 *     participant/toolkit/skill data needed to reach it.
 *  2. The trigger characters "@", "/" and "~" are typed as part of the text,
 *     so all three mention state machines run their detection, not just the
 *     plain-text path.
 *  3. The composer still holds exactly what was typed afterwards, and the send
 *     control appeared — i.e. the input is functional, not merely quiet.
 *
 * It deliberately does NOT assert on any mention dropdown: this stack seeds no
 * co-participants, toolkits or skills for the member persona, so a visible "/"
 * or "~" list is not a thing this stack can produce. Asserting one would be a
 * test of the seed, and the guarded `if (visible)` shape that would let it
 * "pass" anyway is exactly what this file's neighbours had to have removed.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL } from '../../../playwright.config';

/**
 * Contains all three mention triggers. "@" and "~" are preceded by a space and
 * "/" follows a word, so `detectMention`'s "start-of-text or whitespace"
 * precondition holds for the two that need it — the point is to enter the
 * detection branches, not just the early return.
 */
const TYPED = 'hi @a b/c ~d';

test('the composer takes keystrokes without throwing (#597)', async ({ page }) => {
  await page.goto(BASE_URL + '/app/chat');
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });

  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 15_000 });

  // Registered only now, so unrelated errors from page load (a peripheral 401
  // re-auth, a slow socket) can never be attributed to a keystroke. Everything
  // collected below happened while typing.
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

  await input.click();
  await input.pressSequentially(TYPED, { delay: 20 });

  // The input is quiet AND working: it kept every character, and the send
  // control — which `ChatBox` renders only in response to input — appeared.
  await expect(input).toHaveValue(TYPED);
  await expect(page.getByTestId('chat-send-button')).toBeEnabled({ timeout: 5_000 });

  // Read LAST, and only after a round-trip to the page. `pageerror` is
  // delivered asynchronously over CDP, so a throw from the FINAL keystroke —
  // or from something that keystroke scheduled — can still be in flight when
  // `pressSequentially` resolves; read on the next line it would be missed and
  // this test would go green on a broken composer. Protocol events arrive in
  // order on one connection, so awaiting a round-trip issued after the last
  // keypress guarantees every error the typing already raised has landed.
  //
  // Note it must be a round-trip and not `expect.poll`: polling for an EMPTY
  // array passes on its first read, so it would not wait at all.
  await page.evaluate(() => undefined);
  expect(pageErrors, 'typing into the composer must not throw').toEqual([]);
});
