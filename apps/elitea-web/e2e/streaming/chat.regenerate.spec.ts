/**
 * REGENERATE: a second answer to the SAME question, written OVER the first.
 *
 * The failure this exists to make impossible is the quiet one — a regeneration
 * that APPENDS. A transcript that grows a second assistant row per click looks
 * fine on screen for one click, and then the conversation the next turn is
 * conditioned on contains two contradictory answers to one question. Nothing in
 * the unit suite can see it: the shape lives in one Postgres statement
 * (`ResetCurrentAgentResponse`) and in what the browser actually posts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT, AS MEASURED AGAINST THE RUNNING STACK
 * ─────────────────────────────────────────────────────────────────────────────
 * REPLACEMENT, in place, and the replacement is total:
 *
 *   POST /api/v2/elitea_core/regenerate/prompt_lib/{project}/{responseMessageUuid}
 *        ?execution_contract=agent.regenerate.v1
 *
 * answers 200 with `response_message_id` equal to the assistant row's OWN uuid.
 * Server-side, `ResetCurrentAgentResponse`
 * (`services/elitea-main/internal/db/queries/agent_chat.sql`) DELETEs that
 * group's `chat_message_items` and trace steps, strips its interrupt/skill
 * metadata, stamps a fresh `meta.execution_generation`, and flips
 * `is_streaming` back to TRUE — all on the row that already exists. No group is
 * inserted and none is removed, so the transcript stays at two rows and both
 * keep their `id`, `uid` and `created_at`.
 *
 * That last part is why row identity ALONE cannot carry this test: a
 * regeneration that never reached the model would also leave two rows with the
 * same ids. `meta.execution_generation` is the discriminator — it is set to the
 * `regeneration_id` the browser minted for THIS click, so the assertion below
 * ties the stored row to the exact button press that produced it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DRIVES THE ANSWER'S "Regenerate", NOT THE QUESTION'S EDIT CONTROL
 * ─────────────────────────────────────────────────────────────────────────────
 * `e2e/journeys/chat/chat.conversation.spec.ts` J9 drives "Edit the message and
 * regenerate answer" on the user's own bubble. That control is out of reach the
 * moment a turn has been answered and persisted, for TWO independent reasons —
 * both measured here, not inferred:
 *
 *  1. THE UI DOES NOT OFFER IT. `ChatMessageList`'s `isEligibleForEdit` requires
 *     `userId === message.userId`, and a transcript loaded from the server
 *     states no author id at all: `GET …/messages/…` returns no user field, so
 *     `normaliseUserMessage`'s `userOptionalFields` omits `userId`
 *     (`entities/message/lib/normalise.ts`). J9 only reaches the control
 *     because it acts on the OPTIMISTIC bubble the send path stamped the
 *     signed-in user onto — and this journey cannot: the first send navigates
 *     to `/app/chat/{id}` (`pages/chat/index.tsx`'s `handleConversationCreated`),
 *     which re-reads the transcript from the server. Measured on the live
 *     stack: after the turn settles the question bubble offers exactly one
 *     button, "Copy to clipboard", and the answer offers "Regenerate".
 *  2. THE SERVER REFUSES AN EDITED QUESTION ANYWAY. The regeneration route
 *     rejects any body whose `updated_items` is non-empty
 *     (`route.go`: `!emptyJSONArray(body.UpdatedItems)` → 422
 *     `unsupported_agent_execution`), and the client mirrors that refusal —
 *     `buildRegenerateBody` returns `undefined` when `updatedItems` is
 *     non-empty, so an edited question would fall back to the pre-#93 REST
 *     call, which this route answers 400 for want of an `execution_contract`.
 *     That refusal is asserted below rather than described, because it is the
 *     reason "edit and regenerate" cannot be an assertion about a REPLACED
 *     answer: on the current contract a regeneration re-runs the question as
 *     stored, and changing the question is a different turn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PRECONDITION THE PRODUCT DOES NOT STATE
 * ─────────────────────────────────────────────────────────────────────────────
 * A regeneration is refused 409 `agent_regeneration_pending` while the answer's
 * `chat_message_group.is_streaming` is still TRUE, and that flag is cleared
 * AFTER the answer text is written. So both signals a user has — the answer is
 * on screen, the composer is released — can be true while the button they gate
 * is still refused, and the UI swallows the refusal
 * (`createRegenerateAnswer` restores the previous answer and warns to the
 * console). This spec waits on the column instead of racing it; see
 * `waitForAnswerSettled`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT NO BACKEND HERE CAN DISCRIMINATE
 * ─────────────────────────────────────────────────────────────────────────────
 * The regenerated TEXT is deliberately not required to differ from the first
 * answer, and not required to match it either. The offline mock is
 * deterministic — a second run of the same question returns the same bytes, so
 * "the text changed" would fail against a perfectly correct regeneration. A
 * real model is the opposite: it may or may not repeat itself, so "the text is
 * unchanged" is equally unassertable. Everything this file claims about the
 * answer therefore comes from what the SERVER recorded about the run, not from
 * comparing two model outputs.
 *
 * WHY IT LIVES HERE: `journeys/**` runs against
 * `docker-compose.e2e-standalone.yml`, which has no runtime plane, no worker
 * and no model — no assistant message ever arrives there, so no answer-side
 * Regenerate control can render at all. The `chat-stream` project matches
 * `streaming/chat.*` and runs against the full standalone stack via
 * `scripts/chat-stream-e2e.sh`, serially (`--workers=1`).
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';
import { expectStoredAssistantAnswer, readStoredTranscript } from '../fixtures/api';

/** Matched WITHOUT a project id: the chat driver acts inside its own personal project (#290). */
const CONVERSATIONS_RE = /\/elitea_core\/conversations\/prompt_lib\/(\d+)$/;
const START_RE = /\/elitea_core\/messages\/prompt_lib\/(\d+)\/[0-9a-f-]+/;
const REGENERATE_RE = /\/elitea_core\/regenerate\/prompt_lib\/(\d+)\/([0-9a-f-]+)$/;

/** The model `seed-llm` seeds; `E2E_CHAT_MODEL` names a real one an operator has instead. */
const MODEL_NAME = process.env['E2E_CHAT_MODEL'] ?? 'E2E-MOCK-MODEL';

/** `ChatBox` names the conversation after the question, truncated to 50 chars. */
const MAX_NAME = 50;

/** The run's own token — see `chat.multiturn.spec.ts` for why `Date.now()` alone is not enough. */
function uniqueToken(tag: string): string {
  return `${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
}

/**
 * Block until the server would ACCEPT a regeneration of `answerUid`.
 *
 * The precondition is one column: `ResolveCurrentRegeneration`
 * (`internal/infra/db/repos/agent_start.go`) refuses with
 * `ErrCurrentAgentRegenerationStillFinalizing` — HTTP 409
 * `agent_regeneration_pending`, `retryable: true` — while the answer's
 * `chat_message_group.is_streaming` is still TRUE.
 *
 * That flag is cleared AFTER the text is written, so "the finished answer is in
 * the transcript" does NOT imply "a regeneration will be admitted". Measured:
 * clicking Regenerate the moment `expectStoredAssistantAnswer` returned and the
 * composer went editable answered 409. Both of those are the signals the
 * PRODUCT gives a user, which makes this a real finding rather than a harness
 * detail — the button is offered, and the 409 that follows is swallowed
 * (`createRegenerateAnswer` restores the previous answer and warns to the
 * console). This spec waits for the server-side precondition instead of
 * racing it, so a 409 here would mean the flag never cleared — a stuck turn —
 * rather than a click that was merely early.
 *
 * `is_streaming` is not on the transcript route; it is served per group by the
 * conversation's own detail response under `messages_limit`.
 */
async function waitForAnswerSettled(
  page: Page,
  projectId: string,
  conversationId: string,
  answerUid: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const detail = await page.request.get(
          `${BASE_URL}/api/v2/elitea_core/conversation/prompt_lib/${projectId}/${conversationId}?messages_limit=50`,
        );
        if (!detail.ok()) return `HTTP_${detail.status()}`;
        const body = (await detail.json()) as {
          message_groups?: readonly { uuid?: string; is_streaming?: boolean }[];
        };
        const group = (body.message_groups ?? []).find((item) => item.uuid === answerUid);
        if (group === undefined) return 'MISSING';
        return group.is_streaming === true ? 'STREAMING' : 'SETTLED';
      },
      {
        timeout: 120_000,
        message:
          'the answer row never cleared is_streaming, so every regeneration of it would be refused ' +
          '409 agent_regeneration_pending — the turn finalised its text but not its run',
      },
    )
    .toBe('SETTLED');
}

test('regenerating rewrites the SAME answer row rather than appending a second one', async ({ page }) => {
  // Two model calls — the turn and its regeneration — plus stack round trips.
  // Every wait below is bounded well under this, so a real hang fails on its
  // own step rather than on the clock.
  test.setTimeout(360_000);

  const token = uniqueToken('rg');
  const prompt = `autotest echo exactly: ${token}`;
  expect(prompt.length, 'the prompt must fit the 50-char conversation-name truncation').toBeLessThanOrEqual(MAX_NAME);

  // Counted for the whole test. A "regeneration" that quietly opened a new turn
  // — a fresh conversation, or a second start POST — would leave the transcript
  // assertions below satisfiable in shapes this catches and they do not.
  const conversationCreates: string[] = [];
  const starts: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    const method = response.request().method();
    if (method !== 'POST') return;
    if (CONVERSATIONS_RE.test(path)) conversationCreates.push(`${response.status()} ${path}`);
    if (START_RE.test(path)) starts.push(`${response.status()} ${path}`);
  });

  await page.goto(`${BASE_URL}/app/chat`);
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('model-selector-button').click();
  const modelOption = page.getByRole('menuitem').filter({ hasText: MODEL_NAME }).first();
  await expect(modelOption, `the seeded model ${MODEL_NAME} must be offered`).toBeVisible({ timeout: 20_000 });
  await modelOption.click();
  await expect(page.getByTestId('model-selector-name')).toContainText(MODEL_NAME, { timeout: 10_000 });

  // ── One completed turn ──────────────────────────────────────────────────
  const created = page.waitForResponse(
    (r) => CONVERSATIONS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );
  const started = page.waitForResponse(
    (r) => START_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );

  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 20_000 });
  await input.fill(prompt);
  await expect(page.getByTestId('chat-send-button')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('chat-send-button').click();

  const createdResponse = await created;
  expect(createdResponse.status(), 'the send must create a real conversation').toBe(201);
  const projectId = CONVERSATIONS_RE.exec(new URL(createdResponse.url()).pathname)?.[1] ?? '';
  const conversation = (await createdResponse.json()) as { id?: string; uuid?: string };
  const conversationId = conversation.id ?? '';
  expect(conversationId, 'the conversation must carry a server-assigned id').toMatch(/^\d+$/);

  const startResponse = await started;
  expect(
    startResponse.status(),
    `the turn to be regenerated was itself refused: ${(await startResponse.text()).slice(0, 300)}`,
  ).toBe(200);

  await expectStoredAssistantAnswer(page, projectId, conversationId, {
    timeout: 120_000,
    message: 'there is no answer to regenerate — the first turn never stored one',
    contains: token,
  });

  await page.waitForURL(new RegExp(`/app/chat/${conversationId}(?:[/?#]|$)`), { timeout: 60_000 });
  await expect(page.getByTestId('chat-message-input')).toBeEditable({ timeout: 120_000 });

  // The transcript as it stands, captured BEFORE the click. Every claim about
  // what regeneration did is a comparison against this, not against a
  // hardcoded expectation of what a conversation looks like.
  const before = await readStoredTranscript(page, projectId, conversationId);
  expect(
    before.map((row) => row.role),
    'the conversation must hold exactly one question and one answer before regenerating',
  ).toEqual(['user', 'assistant']);
  const questionBefore = before[0];
  const answerBefore = before[1];
  const generationBefore = String(answerBefore?.metadata['execution_generation'] ?? '');
  expect(
    generationBefore,
    'the completed answer must record which run produced it, or nothing can tell a regeneration from a no-op',
  ).not.toBe('');

  // The run behind that answer has to have finished, not just its text — see
  // `waitForAnswerSettled` for the column that decides it and for why the
  // product's own "your turn again" signals are not enough.
  await waitForAnswerSettled(page, projectId, conversationId, answerBefore?.uid ?? '');

  // ── The control ─────────────────────────────────────────────────────────
  // Hovered, not clicked blind: the action row is `visibility: hidden` until
  // its answer block is hovered (`ApplicationAnswer.tsx`), and `visibility`
  // removes an element from the accessibility tree — so a Regenerate button
  // that exists but never becomes reachable is a defect this step surfaces as
  // "not visible" rather than passing on a DOM node no user could press.
  const answerCard = page.getByTestId('application-answer').first();
  await answerCard.getByTestId('skill-test-last-response').hover();
  const regenerate = answerCard.getByRole('button', { name: 'Regenerate' });
  await expect(
    regenerate,
    'a completed answer must offer Regenerate — it is gated on the turn no longer streaming',
  ).toBeVisible({ timeout: 20_000 });
  await expect(regenerate, 'Regenerate must be usable once the turn has finished').toBeEnabled();

  const regenerated = page.waitForResponse(
    (r) => REGENERATE_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await regenerate.click();

  const regenerateResponse = await regenerated;
  expect(
    regenerateResponse.status(),
    `the regeneration was refused: ${(await regenerateResponse.text()).slice(0, 300)}`,
  ).toBe(200);

  // The SSE contract, opted into by query parameter. Without it the Go route
  // answers 400 outright, so a client that dropped the parameter would fall
  // silently back to a socket this stack does not run.
  const regenerateUrl = new URL(regenerateResponse.url());
  expect(
    regenerateUrl.searchParams.get('execution_contract'),
    'regeneration must opt into the current execution contract',
  ).toBe('agent.regenerate.v1');
  // The route's last path segment is the answer being replaced. This is the
  // single strongest statement of "replacement": the request names an EXISTING
  // message rather than asking for a new one.
  expect(
    REGENERATE_RE.exec(regenerateUrl.pathname)?.[2],
    'the regeneration must address the answer that already exists',
  ).toBe(answerBefore?.uid);

  const regenerateBody = (await regenerateResponse.json()) as { events_url?: string; response_message_id?: string };
  expect(regenerateBody.events_url, 'the regeneration must hand back a stream to read').toMatch(
    /^\/api\/v2\/executions\/\d+\/[0-9a-f]+\/events$/,
  );
  expect(
    regenerateBody.response_message_id,
    'the server must confirm it is rewriting the same answer, not creating one',
  ).toBe(answerBefore?.uid);

  // The id the BROWSER minted for this click. It becomes the row's
  // `meta.execution_generation` server-side (`CurrentRegenerateTurn.ExecutionGeneration`
  // ← `request.RegenerationID`), which is what lets the stored row be tied back
  // to this exact button press below.
  const sentBody = JSON.parse(regenerateResponse.request().postData() ?? '{}') as {
    regeneration_id?: string;
    updated_items?: unknown[];
    message_id?: string;
  };
  expect(sentBody.regeneration_id, 'the client must mint an id for this regeneration').toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(sentBody.message_id, 'the body must name the answer the URL names').toBe(answerBefore?.uid);

  // ── The replacement, in the store ───────────────────────────────────────
  // Polled on the generation stamp rather than on the text: mid-run the row is
  // legitimately empty (the reset DELETEs its items first), so "content is
  // non-empty" alone would race the write-back, and "content changed" is not
  // assertable at all against a deterministic mock.
  await expect
    .poll(
      async () => {
        const rows = await readStoredTranscript(page, projectId, conversationId);
        const answer = rows.find((row) => row.uid === answerBefore?.uid);
        if (answer === undefined || answer.content.trim() === '') return '';
        return String(answer.metadata['execution_generation'] ?? '');
      },
      {
        timeout: 180_000,
        message:
          'the regenerated answer never finished: the row is still empty, or still carries the ' +
          'generation stamp of the run it was supposed to replace',
      },
    )
    .toBe(sentBody.regeneration_id);

  const after = await readStoredTranscript(page, projectId, conversationId);

  // REPLACEMENT, not append — the whole point of the file.
  expect(
    after.map((row) => `${row.role}:${row.uid}`),
    'regenerating must rewrite the existing answer: the transcript must still be one question and one answer, ' +
    'with the same identities',
  ).toEqual([`user:${questionBefore?.uid ?? ''}`, `assistant:${answerBefore?.uid ?? ''}`]);

  // The question is untouched. On this contract a regeneration re-runs the
  // question AS STORED (an edited question is refused — see the header), so a
  // regeneration that rewrote it would be rewriting history.
  expect(after[0]?.content, 'regenerating must not alter the question').toBe(questionBefore?.content);

  const answerAfter = after[1];
  expect(answerAfter?.isError, 'the regenerated answer must not be a stored refusal').toBe(false);
  expect(
    (answerAfter?.content ?? '').trim().length,
    'the regenerated answer must not be left empty — the reset clears the row before the run refills it',
  ).toBeGreaterThan(0);
  expect(
    String(answerAfter?.metadata['execution_generation'] ?? ''),
    'the answer must record the NEW run, not the one it replaced',
  ).not.toBe(generationBefore);

  // Nothing else moved. `message_count` is a `COUNT(*)` over
  // `chat_message_group` computed by the conversation's own detail query — an
  // independent witness that the regeneration inserted no group and deleted
  // none.
  const detail = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/conversation/prompt_lib/${projectId}/${conversationId}`,
  );
  expect(detail.status(), 'the conversation must still be readable at its own route').toBe(200);
  expect(
    ((await detail.json()) as { message_count?: number }).message_count,
    'a regeneration must not change how many message groups the conversation holds',
  ).toBe(2);

  expect(conversationCreates, 'regenerating must not open another conversation').toHaveLength(1);
  expect(
    starts,
    'regenerating must go through the regeneration route, never through a fresh turn start',
  ).toHaveLength(1);

  // ── The refusal that makes "edit and regenerate" a different turn ───────
  // Posted with the SAME shape the browser just used, changed in exactly one
  // field: a non-empty `updated_items`. The route refuses it
  // (`!emptyJSONArray(body.UpdatedItems)` → 422 `unsupported_agent_execution`),
  // and that refusal is the contract, not an accident: a regeneration re-runs
  // the question the conversation already holds. It is asserted here so that
  // wiring an edited question into this route can never land silently — it
  // would turn this assertion red and force the shape to be decided rather
  // than discovered in production.
  const withEditedQuestion = await page.request.post(
    `${BASE_URL}/api/v2/elitea_core/regenerate/prompt_lib/${projectId}/${answerBefore?.uid ?? ''}` +
    '?execution_contract=agent.regenerate.v1',
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ...sentBody,
        regeneration_id: randomUUID(),
        updated_items: [{ uuid: questionBefore?.uid ?? '', content: `${prompt} edited`, item_type: 'text_message' }],
      },
    },
  );
  expect(
    withEditedQuestion.status(),
    'a regeneration carrying an edited question must be refused, not silently run against the stored one',
  ).toBe(422);
  expect(
    ((await withEditedQuestion.json()) as { error?: string }).error,
    'the refusal must name the unsupported execution, so a client can tell it from a validation error',
  ).toBe('unsupported_agent_execution');

  // And the refusal changed nothing.
  const afterRefusal = await readStoredTranscript(page, projectId, conversationId);
  expect(
    afterRefusal.map((row) => `${row.role}:${row.uid}`),
    'a refused regeneration must leave the transcript exactly as it was',
  ).toEqual([`user:${questionBefore?.uid ?? ''}`, `assistant:${answerBefore?.uid ?? ''}`]);
  expect(afterRefusal[0]?.content, 'a refused regeneration must not apply the edit it carried').toBe(
    questionBefore?.content,
  );
});
