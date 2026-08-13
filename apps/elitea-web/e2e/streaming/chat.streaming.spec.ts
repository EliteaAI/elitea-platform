/**
 * Chat definition-of-done journey (#284 tasks 1-2).
 *
 * The single behavioural gate for the product core loop: log in, send, watch an
 * answer stream in, reload, and find it still there. The 2026-08-12 audit found
 * Send silently no-op with every unit suite green — this is what makes that
 * unfalsifiable claim falsifiable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS NOT UNDER e2e/journeys/
 * ─────────────────────────────────────────────────────────────────────────────
 * The `chromium`/`webkit` projects match `journeys/**` and run against
 * `docker-compose.e2e-standalone.yml`, which has NO runtime plane, NO agent
 * worker and NO model backend — an agent turn cannot happen there at all. This
 * journey needs the full standalone stack, so it is its own Playwright project
 * (`chat-stream`) driven by `scripts/chat-stream-e2e.sh`. Putting it under
 * `journeys/` would make every existing E2E run fail on a stack that was never
 * meant to serve it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THESE ASSERTIONS DISCRIMINATING
 * ─────────────────────────────────────────────────────────────────────────────
 * The standalone stack sets `VITE_SOCKET_SERVER: ""`, so the app builds
 * `createNoopSocketClient()` — `emit`/`on` are no-ops. There is therefore NO
 * socket path in this stack: neither `chat_predict` nor `chat_message_sync` can
 * deliver anything. An assistant answer appearing on screen before any reload
 * can only have arrived over the SSE replay stream and through the ported
 * reducer. That is the whole point of running the journey here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CURRENTLY EXPECTED TO FAIL — #294
 * ─────────────────────────────────────────────────────────────────────────────
 * The loop WORKS: with #291/#292/#293 fixed this journey drives a real turn all
 * the way through — model selection, conversation, participants, admission, the
 * SSE stream — and the answer renders. It renders twice and all at once (#294):
 * whole-message frames are appended after the streamed chunks, and nothing is
 * painted incrementally even with the mock slowed to 800ms per chunk. The
 * assertion below that fails is the incremental one, which is exactly the
 * defect.
 *
 * The wire contract asserted below is the one the backend actually emits, NOT
 * the `chat.stream.chunk`/`chat.stream.done` pair #284's body names: every frame
 * arrives as one SSE `execution.node_event` whose semantic type lives in the
 * payload. Grep for those two names in `services/**` returns nothing; asserting
 * them would fail against a perfectly healthy stream.
 */
import { expect, test } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';

/**
 * Route shapes, matched WITHOUT pinning a project id.
 *
 * The chat driver acts inside its own personal project — the app selects the
 * signed-in user's personal project, and that is also the project whose
 * credential the /llm hop resolves (#290). Hardcoding `1` here would assert
 * against a project this persona never opens, so the id is read back from the
 * app's own requests instead.
 */
const CONVERSATIONS_RE = /\/elitea_core\/conversations\/prompt_lib\/(\d+)$/;
const START_RE = /\/elitea_core\/messages\/prompt_lib\/(\d+)\/[0-9a-f-]+/;
const EVENTS_RE = /\/executions\/(\d+)\/[^/]+\/events/;

/** The model `seed-llm` seeds into every personal project. */
const MODEL_NAME = 'E2E-MOCK-MODEL';

/** `ChatBox` names the conversation after the question, truncated to 50 chars. */
const MAX_NAME = 50;

function uniquePrompt(): string {
  // The mock echoes the prompt back, so a value unique to THIS run is what
  // proves the rendered answer was produced by this turn rather than replayed
  // from a previous one or served from a cache.
  const text = `autotest stream ${Date.now()}`;
  expect(text.length, 'the prompt must fit the 50-char conversation-name truncation').toBeLessThanOrEqual(MAX_NAME);
  return text;
}

test('the chat loop works end to end: send, stream, persist, reload', async ({ page }) => {
  // A whole agent turn — conversation create, admission, dispatch to the
  // worker, a model call and the stream back — does not fit Playwright's 30s
  // default. The individual waits below are each bounded well under this, so a
  // real hang still fails on the specific step rather than on the clock.
  test.setTimeout(180_000);

  // Expected to fail until #294 lands — see the module header. Remove this line
  // with that fix; leaving it makes the suite fail once the answer paints once
  // and incrementally, which is the point.
  test.fail(!process.env['CHAT_STREAM_UNMASK'], 'blocked by #294: the answer renders twice and never incrementally');

  const prompt = uniquePrompt();

  // ── The negative guard (#284): count every request the send path makes ──
  // The failure mode this journey exists to kill is a Send that renders
  // optimistically and never reaches the server. Counting real requests — not
  // spinners — is what makes that impossible to pass.
  const sendRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (START_RE.test(url) || EVENTS_RE.test(url)) sendRequests.push(`${request.method()} ${url}`);
  });

  await page.goto(BASE_URL + '/app/chat');
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

  // Pick the seeded model, as #284 asks. It is not decoration: an ad-hoc turn
  // resolves against a `dummy` participant carrying the model, and the start
  // route reads `llm_settings.model_name`. With nothing selected the send is
  // rejected 400 before it reaches the worker.
  await page.getByTestId('model-selector-button').click();
  const modelOption = page.getByRole('menuitem').filter({ hasText: MODEL_NAME }).first();
  await expect(modelOption, `the seeded model ${MODEL_NAME} must be offered`).toBeVisible({ timeout: 20_000 });
  await modelOption.click();
  await expect(page.getByTestId('model-selector-name')).toContainText(MODEL_NAME, { timeout: 10_000 });

  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 15_000 });
  // The send control does not exist while the composer is empty; a stub that
  // always paints one fails here.
  await expect(page.getByTestId('chat-send-button')).toHaveCount(0);
  await input.fill(prompt);
  const sendButton = page.getByTestId('chat-send-button');
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });

  // Both halves of the transport are awaited as RESPONSES, so a start that
  // 4xx's or a stream that never opens fails here rather than timing out later
  // against a blank message list.
  const created = page.waitForResponse(
    (r) => CONVERSATIONS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  const started = page.waitForResponse(
    (r) => START_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  const streamed = page.waitForResponse((r) => EVENTS_RE.test(r.url()), { timeout: 30_000 });

  await sendButton.click();

  const createdResponse = await created;
  expect(createdResponse.status(), 'the send must create a real conversation').toBe(201);
  const conversation = (await createdResponse.json()) as { id?: string; name?: string };
  expect(conversation.id, 'the conversation must carry a server-assigned id').toMatch(/^\d+$/);
  expect(conversation.name, 'the conversation is named after the question that opened it').toBe(prompt);

  const startResponse = await started;
  expect(startResponse.status(), 'the agent-execution start must be admitted').toBe(200);
  const startBody = (await startResponse.json()) as { events_url?: string; task_id?: string };
  // `events_url` is the server's own absolute path. Its ABSENCE is the
  // documented signal that a backend serves no replay stream — on this stack it
  // must be present, or the UI silently fell back to a socket that cannot work.
  expect(startBody.events_url, 'the start response must carry the stream to read').toMatch(
    /^\/api\/v2\/executions\/\d+\/[0-9a-f]+\/events$/,
  );

  const streamResponse = await streamed;
  expect(streamResponse.status(), 'the browser must be able to READ the stream it is meant to render').toBe(200);
  expect(
    streamResponse.headers()['content-type'] ?? '',
    'the replay stream must be served as SSE',
  ).toContain('text/event-stream');

  // ── A token rendered BEFORE the turn finished ──
  // The stack runs the mock with MOCK_LLM_CHUNK_DELAY_MS set, so the answer
  // arrives over several paints instead of one. Sampling the answer while the
  // composer is still disabled observes a genuinely partial render; without the
  // delay a browser may legitimately paint only the finished answer, which
  // would make this flaky rather than wrong.
  const answer = page.getByTestId('chat-message-list').getByTestId('application-answer').first();
  await expect(answer, 'an assistant turn must appear while the run is still open').toBeVisible({ timeout: 30_000 });

  let partial = '';
  await expect
    .poll(
      async () => {
        const text = (await answer.textContent()) ?? '';
        if (text.trim() && !text.includes(prompt)) partial = text.trim();
        return partial.length;
      },
      {
        timeout: 20_000,
        message: 'no partial answer was ever painted — the reply arrived in one frame, not as a stream',
      },
    )
    .toBeGreaterThan(0);

  // ── The completed answer ──
  // The mock echoes this run's unique prompt, so this cannot pass on a cached
  // or misrouted response. Asserted BEFORE any reload: with the socket disabled
  // there is no other producer, so the text on screen came off the SSE stream
  // through the reducer.
  await expect(answer, 'the streamed answer must echo THIS run’s prompt').toContainText(prompt, { timeout: 60_000 });
  expect(partial.length, 'the partial paint must be shorter than the finished answer').toBeLessThan(
    ((await answer.textContent()) ?? '').trim().length,
  );

  // Terminal state: the composer is usable again once the turn completes.
  await expect(page.getByTestId('chat-message-input'), 'the composer must be released when the turn ends').toBeEditable(
    { timeout: 60_000 },
  );

  // The negative guard, now that both halves have been observed.
  expect(sendRequests.length, `the send path made no request at all: ${JSON.stringify(sendRequests)}`).toBeGreaterThan(0);
  expect(sendRequests.some((entry) => entry.startsWith('POST'))).toBe(true);

  // ── Persistence, through the UI ──
  // A FRESH load of the conversation's own URL re-reads everything from the
  // server, so this fails against a stack that streamed the answer and never
  // stored it. `/app/chat` itself is not reloaded, because the send path never
  // navigates there (`pages/chat/index.tsx` has no "conversation created"
  // callback) — reloading it would open an empty chat and assert nothing.
  await page.goto(`${BASE_URL}/app/chat/${conversation.id ?? ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Something went wrong.')).toHaveCount(0);
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

  const list = page.getByTestId('chat-message-list');
  await expect(list.getByTestId('user-message').filter({ hasText: prompt }).first()).toBeVisible({ timeout: 30_000 });
  await expect(
    list.getByTestId('application-answer').filter({ hasText: prompt }).first(),
    'the assistant reply must survive a reload',
  ).toBeVisible({ timeout: 30_000 });
});
