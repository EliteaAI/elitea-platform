/**
 * The AGENT turn, authored and driven entirely through the UI.
 *
 * `chat.streaming.spec.ts` covers the ad-hoc turn: a chat with a model and no
 * participant. That path never reads a stored agent version, so it cannot see
 * any of the defects this file exists for. Every one of them was found by
 * driving a real browser against the full standalone stack running the NATIVE
 * RUST worker and a real model, and each was bisected against a live database
 * one field at a time:
 *
 *  1. The create-agent form seeded `version_details.meta.internal_tools` as
 *     `['internal_mcp']`. The agent resolver admits only `[]` or
 *     `["ask_user"]` (`services/elitea-main/internal/db/queries/agent_chat.sql`),
 *     so the join produced no row and every send answered HTTP 422 "This agent
 *     turn requires the current execution path."
 *  2. Adding an agent from the "+" menu wrote a participant with no
 *     `entity_settings.version_id`. The same resolver joins the version through
 *     exactly that key, so the turn was refused for a second, independent
 *     reason — and the browser could not tell the two apart.
 *  3. On a chat with no conversation yet, picking an agent did NOTHING: no
 *     request, no chip, no error, no console line.
 *
 * All three are UI defects and all three are invisible to the unit suite, which
 * is why this journey authors the agent through the FORM and attaches it
 * through the MENU rather than through `fixtures/api.ts`. A version created by
 * the API fixture carries whatever that fixture types; only the form carries
 * what a user actually gets.
 *
 * WHY IT LIVES HERE: `journeys/**` runs against `docker-compose.e2e-standalone.yml`,
 * which has no runtime plane, no worker and no model — an agent turn cannot
 * happen there at all. The `chat-stream` project matches `streaming/chat.*` and
 * runs against the full standalone stack via `scripts/chat-stream-e2e.sh`.
 *
 * It passes on BOTH workers, and that is the point: the Python worker and the
 * native Rust worker are selected by `STANDALONE_WORKER`, and a UI that only
 * drives one of them is the regression this file catches.
 */
import { expect, test, type Page } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';
import { AUTOTEST_PREFIX } from '../fixtures/api';

/** Matched WITHOUT a project id: the chat persona works inside its own personal project (#290). */
const START_RE = /\/elitea_core\/messages\/prompt_lib\/(\d+)\/[0-9a-f-]+/;
const EVENTS_RE = /\/executions\/(\d+)\/[^/]+\/events/;
const PARTICIPANTS_RE = /\/elitea_core\/participants\/prompt_lib\/(\d+)\/([^/?]+)/;
const APPLICATIONS_RE = /\/elitea_core\/applications\/prompt_lib\/(\d+)$/;

/**
 * A name that survives the form.
 *
 * `CreateAgentForm` caps the name input at 32 characters
 * (`features/agents/lib/helpers/agentDraftValidation.helpers.ts`), and
 * `fill()` respects `maxLength` — so a longer name is silently truncated and
 * every later lookup by that name finds nothing, with a failure that reads
 * like the agent was never created. The length is asserted rather than
 * assumed, because the failure mode is invisible at the call site.
 */
const MAX_AGENT_NAME = 32;

function agentName(): string {
  const name = `${AUTOTEST_PREFIX}agent-${Date.now() % 1_000_000}`;
  expect(name.length, 'the agent name must survive the form’s 32-char cap').toBeLessThanOrEqual(
    MAX_AGENT_NAME,
  );
  return name;
}

/** Open the "+" menu, walk into one entity submenu, and pick a row by name. */
async function attachParticipant(page: Page, submenu: string, name: string): Promise<void> {
  await page.getByTestId('plus-menu-button').click();
  const submenuRow = page.getByRole('menuitem').filter({ hasText: submenu }).first();
  await expect(submenuRow, `the "+" menu must offer ${submenu}`).toBeVisible({ timeout: 15_000 });
  await submenuRow.click();

  const entityRow = page.getByTestId('plus-submenu-item').filter({ hasText: name }).first();
  await expect(entityRow, `${name} must be listed under ${submenu}`).toBeVisible({ timeout: 20_000 });
  await entityRow.click();
}

test('an agent authored in the UI answers in chat, and the participant carries its version', async ({ page }) => {
  // A whole agent turn — create, attach, admission, dispatch, a model call and
  // the stream back. Every wait below is bounded well under this, so a real
  // hang fails on its own step rather than on the clock.
  test.setTimeout(240_000);

  const name = agentName();
  const prompt = `autotest agent ${Date.now()}`;

  // ── 1. Author the agent through the form ────────────────────────────────
  // Through the FORM, because the defect was in what the form seeds. The
  // response is captured so the assertion below reads the version the server
  // actually stored rather than one this test constructed.
  const created = page.waitForResponse(
    (r) => APPLICATIONS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );

  await page.goto(`${BASE_URL}/app/agents/create`);
  await expect(page.getByTestId('agent-name-input')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agent-name-input').fill(name);
  await page.getByTestId('agent-description-input').fill(`${name} description`);
  // Saved with NO instructions, deliberately. The form does not require the
  // field, so this is the agent a user gets by filling in only what the form
  // marks required — and it is the shape the runtime used to refuse, answering
  // "The execution input is invalid." on every turn
  // (services/elitea-worker-rust/src/agents/assembly.rs::bounded_instruction).
  // Typing into the instructions editor would also couple this journey to which
  // code editor the form embeds, which is not what it is here to assert.
  await expect(page.getByTestId('agent-save-button')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('agent-save-button').click();

  const createdResponse = await created;
  expect(createdResponse.status(), 'the agent must be created').toBe(201);
  const projectId = APPLICATIONS_RE.exec(new URL(createdResponse.url()).pathname)?.[1] ?? '';
  expect(projectId, 'the agent must belong to a project').not.toBe('');
  const agent = (await createdResponse.json()) as {
    id?: string;
    version_details?: { id?: string; meta?: { internal_tools?: readonly string[] } };
  };
  const agentId = agent.id ?? '';
  expect(agentId, 'the created agent must carry an id').toMatch(/^\d+$/);

  // The refusal this journey exists for, asserted at the point it is decided.
  // `internal_mcp` here is not a preference: it makes the resolver's version
  // join return nothing, and every send answers 422 with a message about an
  // "execution path" that says nothing about internal tools.
  expect(
    agent.version_details?.meta?.internal_tools ?? [],
    'a new agent must not name an internal tool the platform refuses',
  ).not.toContain('internal_mcp');

  // ── 2. Attach it on a chat that does not exist yet ──────────────────────
  // /app/chat with no conversation id is the screen where the pick used to be
  // a silent no-op, so this is where it has to be exercised.
  await page.goto(`${BASE_URL}/app/chat`);
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

  const attached = page.waitForResponse(
    (r) => PARTICIPANTS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );
  await attachParticipant(page, 'Agents', name);

  // A REQUEST, not a chip: the defect was that the click produced no request at
  // all, and a chip rendered from local state would have hidden that.
  const attachResponse = await attached;
  expect(
    attachResponse.status(),
    'picking an agent on a chat with no conversation must still create the participant',
  ).toBeLessThan(300);
  const conversationUuid = PARTICIPANTS_RE.exec(new URL(attachResponse.url()).pathname)?.[2] ?? '';
  expect(conversationUuid, 'the pick must have created a conversation to attach to').not.toBe('');

  // The version the participant carries is what the resolver joins on. Read it
  // back from the server rather than from the request body: a body that carries
  // it and a row that does not would still refuse every turn.
  //
  // Through the CONVERSATION, because `.../participants/prompt_lib/...` is a
  // write-only route and answers 405 to a GET; the participant list is a member
  // of the conversation's own detail response. That route resolves either
  // identifier form, so the uuid the attach used is enough.
  const conversation = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/conversation/prompt_lib/${projectId}/${conversationUuid}`,
  );
  expect(conversation.ok(), 'the conversation must expose its participants').toBe(true);
  const conversationBody = (await conversation.json()) as {
    participants?: readonly { entity_name?: string; entity_settings?: { version_id?: string | number } }[];
  };
  const agentParticipant = (conversationBody.participants ?? []).find(
    (item) => item.entity_name === 'application' || item.entity_name === 'pipeline',
  );
  expect(agentParticipant, 'the agent must be one of the conversation participants').toBeDefined();
  expect(
    String(agentParticipant?.entity_settings?.version_id ?? ''),
    'the participant must name the agent version, or the resolver joins nothing and every turn is refused',
  ).toBe(String(agent.version_details?.id ?? ''));

  // ── 3. Send, and require the turn to be ADMITTED ───────────────────────
  const started = page.waitForResponse(
    (r) => START_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );
  const streamed = page.waitForResponse((r) => EVENTS_RE.test(r.url()), { timeout: 45_000 });

  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 20_000 });
  await input.fill(prompt);
  await page.getByTestId('chat-send-button').click();

  const startResponse = await started;
  // Spelled out because 422 is the exact status all three defects produced, and
  // its body is the sentence a maintainer will search for.
  expect(
    startResponse.status(),
    `the agent turn was refused: ${(await startResponse.text()).slice(0, 300)}`,
  ).toBe(200);
  const startBody = (await startResponse.json()) as { events_url?: string };
  expect(startBody.events_url, 'the start must hand back a stream to read').toMatch(
    /^\/api\/v2\/executions\/\d+\/[0-9a-f]+\/events$/,
  );

  const streamResponse = await streamed;
  expect(streamResponse.status(), 'the browser must be able to read the stream').toBe(200);
  expect(streamResponse.headers()['content-type'] ?? '', 'the stream must be SSE').toContain(
    'text/event-stream',
  );

  // ── 4. An answer, and no error card ────────────────────────────────────
  // The failure this replaces was silent: the composer re-enabled and nothing
  // appeared. Requiring non-empty answer text is what makes that unfalsifiable.
  const answer = page.getByTestId('chat-message-list').getByTestId('application-answer').first();
  await expect(answer, 'the agent must produce an answer bubble').toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => ((await answer.textContent()) ?? '').trim().length, {
      timeout: 90_000,
      message: 'the agent turn produced an empty answer — the run was refused after admission',
    })
    .toBeGreaterThan(0);

  await expect(
    page.getByTestId('chat-message-input'),
    'the composer must be released when the turn ends',
  ).toBeEditable({ timeout: 90_000 });

  // ── 5. Persistence ─────────────────────────────────────────────────────
  // The stream runs ahead of the store, so this is polled rather than read once
  // — the same ordering `chat.streaming.spec.ts` documents.
  await expect
    .poll(
      async () => {
        const stored = await page.request.get(
          `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${conversationUuid}`,
        );
        if (!stored.ok()) return '';
        const body = (await stored.json()) as {
          items?: readonly { role?: string; content?: string }[];
        };
        return body.items?.find((item) => item.role === 'assistant')?.content ?? '';
      },
      { timeout: 60_000, message: 'the agent reply was streamed but never stored' },
    )
    .not.toBe('');

  // Cleanup is best-effort and deliberately last: a failure above should leave
  // the agent in place for inspection.
  await page.request.delete(
    `${BASE_URL}/api/v2/elitea_core/application/prompt_lib/${projectId}/${agentId}`,
  );
});
