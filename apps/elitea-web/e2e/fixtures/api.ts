/**
 * API helpers for E2E test setup (issue #60).
 *
 * Used in test setup steps to create entities via API rather than clicking
 * through 5 screens — the Playwright `request` fixture approach from
 * qa/elitea-testing-public's per-domain API helpers.
 *
 * All entities created here use the `autotest_` prefix (per qa/ convention)
 * so failed runs' leftovers are identifiable and sweepable.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';

export const AUTOTEST_PREFIX = 'autotest_';

/**
 * Wait for the sidebar create button to become enabled, then click it.
 * The button stays disabled until the permission query resolves, which
 * requires the project store to hydrate from localStorage. This can take
 * up to ~3 s on a cold page load in the E2E stack.
 */
export async function clickCreateButton(page: Page): Promise<void> {
  const btn = page.getByTestId('sidebar-create-button');
  await expect(btn).toBeEnabled({ timeout: 15_000 });
  await btn.click();
}

/** API base from env (matches the app's VITE_SERVER_URL). */
export const API_BASE = (process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8082') + '/api/v2';

/** Default public project ID (matches compose env VITE_PUBLIC_PROJECT_ID). */
export const DEFAULT_PROJECT_ID = process.env['E2E_PROJECT_ID'] ?? '1';

/**
 * Create a conversation via API.
 * Returns the new conversation id.
 */
export async function createConversation(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const url = `${API_BASE}/elitea_core/conversations/prompt_lib/${DEFAULT_PROJECT_ID}`;
  const resp = await request.post(url, { data: { name } });
  // Check the status BEFORE parsing. Calling `.json()` on a 401 (whose body is
  // not JSON) produced `SyntaxError: Unexpected non-whitespace character after
  // JSON at position 4` — an error that says nothing about the real problem,
  // which was an unauthenticated request context. Fail with the status and body
  // instead, so the next caller diagnoses it in one read.
  if (!resp.ok()) {
    throw new Error(
      `createConversation: POST ${url} -> ${resp.status()} ${resp.statusText()}\n` +
      `${(await resp.text()).slice(0, 300)}\n` +
      'If this is a 401, the request context is unauthenticated — pass `page.request` ' +
      '(which shares the browser context cookies), not the bare `request` fixture.',
    );
  }
  const body = (await resp.json()) as { id?: string };
  if (body.id === undefined) {
    throw new Error(`createConversation: response carried no id: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.id;
}

/**
 * Delete a conversation (cleanup helper).
 */
export async function deleteConversation(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await request.delete(
    `${API_BASE}/elitea_core/conversation/prompt_lib/${DEFAULT_PROJECT_ID}/${id}`,
  );
}

/** An agent created through the API, with the initial version it owns. */
export interface CreatedAgent {
  /** `applications.id` — the SERIAL key every route addresses the agent by. */
  readonly id: string;
  /** `application_versions.id` of the initial version created alongside it. */
  readonly versionId: string;
}

/**
 * Create an agent (application) via API.
 *
 * Sends a `versions` array, exactly as the create-agent form does
 * (`entities/application-form/model/mutations.ts` `toVersionWriteRequest`).
 * An application with no version row is a degenerate entity: `List` INNER
 * JOINs `application_versions`, so it never appears in the agents list, and
 * there is no version for a deep link to open. A fixture that creates one
 * sets its callers up to assert against a shape the product never produces.
 *
 * Throws on a non-2xx response. It previously read `body.id` off whatever
 * came back, so when `POST /elitea_core/applications/...` was returning 404
 * (issue #115) the `.json()` parse threw and every caller's `.catch()`
 * quietly took a degraded branch — the journeys passed while the endpoint
 * they exist to exercise was entirely absent.
 */
export async function createAgent(
  request: APIRequestContext,
  name: string,
): Promise<CreatedAgent> {
  const path = `/elitea_core/applications/prompt_lib/${DEFAULT_PROJECT_ID}`;
  const resp = await request.post(`${API_BASE}${path}`, {
    data: {
      name,
      description: `${AUTOTEST_PREFIX}e2e test agent`,
      type: 'agent',
      versions: [
        {
          name: 'base',
          agent_type: 'openai',
          instructions: 'You are a helpful assistant.',
          conversation_starters: [],
        },
      ],
    },
  });
  if (!resp.ok()) {
    throw new Error(
      `createAgent: POST ${path} returned ${resp.status()}: ${(await resp.text()).slice(0, 300)}`,
    );
  }
  const body = await resp.json();
  const id: unknown = body?.id;
  const versionId: unknown = body?.version_details?.id;
  if (typeof id !== 'string' || typeof versionId !== 'string') {
    throw new Error(
      `createAgent: POST ${path} returned 201 without an id/version_details.id: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return { id, versionId };
}

/**
 * Delete an agent (cleanup helper).
 */
export async function deleteAgent(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await request.delete(
    `${API_BASE}/elitea_core/application/prompt_lib/${DEFAULT_PROJECT_ID}/${id}`,
  );
}

/**
 * Sweep any leftover autotest_* entities (session-scoped safety net).
 * Call this from an afterAll to clean up regardless of test outcome.
 */
export async function sweepAutotestEntities(
  request: APIRequestContext,
): Promise<void> {
  // Sweep conversations
  try {
    const resp = await request.get(
      `${API_BASE}/elitea_core/conversations/prompt_lib/${DEFAULT_PROJECT_ID}`,
    );
    const body = await resp.json();
    const convs: Array<{ id: string; name: string }> = body.rows ?? body ?? [];
    for (const c of convs) {
      if (c.name?.startsWith(AUTOTEST_PREFIX)) {
        await deleteConversation(request, c.id);
      }
    }
  } catch {
    // Best effort — don't fail the test run on cleanup failures.
  }

  // Sweep agents
  try {
    const resp = await request.get(
      `${API_BASE}/elitea_core/applications/prompt_lib/${DEFAULT_PROJECT_ID}`,
    );
    const body = await resp.json();
    const agents: Array<{ id: string; name: string }> = body.rows ?? body ?? [];
    for (const a of agents) {
      if (a.name?.startsWith(AUTOTEST_PREFIX)) {
        await deleteAgent(request, a.id);
      }
    }
  } catch {
    // Best effort.
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The streaming journeys' shared steps
 *
 * `e2e/streaming/chat.*.spec.ts` each drive a full agent turn against the full
 * standalone stack, and each used to hand-roll the same two blocks. They are
 * here, once, because both are load-bearing in ways their call sites cannot
 * see: the form flow encodes what the FORM seeds (the whole reason those
 * journeys exist), and the stored-answer poll encodes the one observation that
 * can tell an answer from a refusal. A copy that drifts out of one spec is a
 * spec that quietly stops discriminating.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Matched WITHOUT a project id: the chat persona works inside its own personal project (#290). */
const APPLICATIONS_RE = /\/elitea_core\/applications\/prompt_lib\/(\d+)$/;

/**
 * The longest agent name that survives the create form.
 *
 * `CreateAgentForm` caps the name input at 32 characters
 * (`features/agents/lib/helpers/agentDraftValidation.helpers.ts`), and
 * `fill()` respects `maxLength` — so a longer name is silently truncated and
 * every later lookup by that name finds nothing, with a failure that reads
 * like the agent was never created. `createAgentThroughForm` asserts it rather
 * than assuming it, because the failure mode is invisible at the call site.
 */
const MAX_AGENT_NAME = 32;

/** What the create-agent FORM actually produced, read back off its own response. */
export interface AgentCreatedThroughForm {
  /** The project the form wrote into — read from the request, never assumed to be 1. */
  readonly projectId: string;
  /** `applications.id` — the key every later route addresses the agent by. */
  readonly agentId: string;
  /** `application_versions.id` — what the agent resolver joins the participant on. */
  readonly versionId: string;
  /** `version_details.meta.internal_tools` exactly as the SERVER stored it. */
  readonly internalTools: readonly string[];
}

/**
 * Author an agent by filling in the create form, and hand back what the server
 * stored.
 *
 * Through the FORM, not through `createAgent()` above, because the defects
 * these journeys exist for were in what the form SEEDS — an
 * `internal_tools: ['internal_mcp']` the agent resolver refuses, so the join
 * produced no row and every send answered 422 about an "execution path". A
 * version created by the API fixture carries whatever that fixture types; only
 * the form carries what a user actually gets.
 *
 * Saved with NO instructions, deliberately. The form does not require the
 * field, so this is the agent a user gets by filling in only what is marked
 * required — and it is the shape the native runtime used to refuse, answering
 * "The execution input is invalid."
 * (`services/elitea-worker-rust/src/agents/assembly.rs::bounded_instruction`).
 * Typing into the instructions editor would also couple these journeys to
 * which code editor the form embeds, which is not what they assert.
 *
 * Leaves the browser on the agent's edit page, which is where the save lands
 * and where the Tools panel and the Chat button live.
 */
export async function createAgentThroughForm(
  page: Page,
  name: string,
): Promise<AgentCreatedThroughForm> {
  expect(name.length, 'the agent name must survive the form’s 32-char cap').toBeLessThanOrEqual(
    MAX_AGENT_NAME,
  );

  // Armed BEFORE the navigation: the response is what carries the project id
  // and the stored version, so the assertions below read what the server
  // actually wrote rather than what the test constructed.
  const created = page.waitForResponse(
    (r) => APPLICATIONS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );

  await page.goto(`${BASE_URL}/app/agents/create`);
  await expect(page.getByTestId('agent-name-input')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agent-name-input').fill(name);
  await page.getByTestId('agent-description-input').fill(`${name} description`);
  await expect(page.getByTestId('agent-save-button')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('agent-save-button').click();

  const response = await created;
  expect(
    response.status(),
    `the agent must be created: ${(await response.text()).slice(0, 300)}`,
  ).toBe(201);

  const projectId = APPLICATIONS_RE.exec(new URL(response.url()).pathname)?.[1] ?? '';
  expect(projectId, 'the agent must belong to a project').not.toBe('');

  const body = (await response.json()) as {
    id?: string;
    version_details?: { id?: string; meta?: { internal_tools?: readonly string[] } };
  };
  const agentId = body.id ?? '';
  expect(agentId, 'the created agent must carry an id').toMatch(/^\d+$/);
  const versionId = String(body.version_details?.id ?? '');
  expect(versionId, 'the created agent must carry a version, or the resolver joins nothing').not.toBe('');

  return {
    projectId,
    agentId,
    versionId,
    internalTools: body.version_details?.meta?.internal_tools ?? [],
  };
}

export interface StoredAssistantAnswerOptions {
  /** How long the store is given to finalise the row. Default 60s. */
  readonly timeout?: number;
  /** The failure line — say what a miss MEANS for this journey. */
  readonly message?: string;
  /**
   * Text the stored answer must contain, checked INSIDE the poll.
   *
   * The offline mock echoes the prompt, which is what proves the answer
   * belongs to this run rather than to a cached or misrouted one. A real model
   * echoes nothing, so a journey driven against one leaves this unset and
   * settles for "the turn produced text".
   */
  readonly contains?: string;
}

/**
 * Require a real assistant answer in the STORE for this conversation.
 *
 * Polled, not read once: the stream runs ahead of the store. Measured — a read
 * issued the moment the UI settled returned the assistant row with
 * `content: ""`, and the same conversation carried the full text moments
 * later, so a single read failed against a backend that was merely still
 * writing.
 *
 * And polled until the row is FINISHED, not merely non-empty. The same lag
 * that makes a single read too early makes "some text is stored" too early in
 * the other direction: the row grows for the whole run, so a poll that stops
 * at the first byte returns while the turn is still being written and leaves
 * it running behind the spec that started it. The `is_error` PRESENCE test
 * inside the poll is what ends the turn here; its note carries the
 * measurements.
 *
 * The STORED reply, not the on-screen bubble, and that is the discriminating
 * part: a refused turn renders its failure AS an assistant card, so "some text
 * appeared" cannot tell an answer from a refusal — one of these specs' own
 * first drafts went green against exactly that card. Only a turn the runtime
 * actually completed finalizes a non-empty assistant row that is not flagged
 * `metadata.is_error`. The `IS_ERROR:` prefix below carries that flag through
 * the poll's string value so the failure names the refusal instead of
 * reporting an empty answer.
 */
export async function expectStoredAssistantAnswer(
  page: Page,
  projectId: string,
  conversationId: string | number,
  options: StoredAssistantAnswerOptions = {},
): Promise<void> {
  const {
    timeout = 60_000,
    message = 'the assistant reply was streamed but never stored',
    contains,
  } = options;

  const pattern =
    contains === undefined
      ? /^(?!IS_ERROR:)[\s\S]+$/
      : new RegExp(`^(?!IS_ERROR:)[\\s\\S]*${escapeForRegExp(contains)}[\\s\\S]*$`);

  await expect
    .poll(
      async () => {
        const stored = await page.request.get(
          `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${String(conversationId)}`,
        );
        if (!stored.ok()) return '';
        const body = (await stored.json()) as {
          items?: readonly { role?: string; content?: string; metadata?: { is_error?: boolean } }[];
        };
        const assistant = body.items?.find((item) => item.role === 'assistant');
        if (assistant?.metadata?.is_error === true) return `IS_ERROR:${assistant.content ?? ''}`;
        // NOT YET FINISHED. `is_error` is written ONLY by a terminal
        // projection — FinalizeCurrentAgentFullMessage and its HITL and
        // authorization twins each set it explicitly
        // (services/elitea-main/internal/db/queries/agent_chat.sql) — while a
        // row that is still streaming carries only `execution_generation`. An
        // ABSENT key therefore means "the run has not landed", and reading it
        // as "not an error" is what let this helper return mid-turn.
        //
        // WHAT THAT COST, measured on the standalone stack rather than
        // reasoned about. The stream runs ahead of the store, so content
        // appears within a second or two and this poll settled there: in one
        // run chat.agent-tools passed in 2.3s while ITS OWN turn kept writing
        // for another 37s, and chat.nested-agent passed in 1.9s while its turn
        // ran 12s more. Every spec then started its turn on top of the
        // previous specs' unfinished ones, against a worker that admits TWO
        // invocations at a time (`delivery_max_concurrency` in
        // deploy/runtime/worker-runtime.json). Later turns queued: one
        // chat.pipeline turn took 116s and its spec failed after 60s of
        // polling for the graph's trace steps, on a run where four turns were
        // in flight at once. Nothing about that failure is a statement about
        // pipelines.
        //
        // Requiring the flag to be PRESENT is what makes this helper's own
        // sentence above true — "only a turn the runtime actually completed
        // finalizes a non-empty assistant row that is not flagged is_error".
        // It is deliberately not "poll until the text stops growing": an agent
        // that pauses between tool calls looks settled to that rule, and this
        // one cannot be fooled by a gap in the tokens.
        //
        // `readStoredAssistantAnswer` keeps the old, weaker read on purpose —
        // chat.stop MUST be able to sample a half-written row.
        if (assistant?.metadata?.is_error !== false) return '';
        return assistant.content ?? '';
      },
      { timeout, message },
    )
    .toMatch(pattern);
}

/** Escape a literal so `contains` above can be embedded in a RegExp unchanged. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface StoredTurnRefusalOptions {
  /** How long the store is given to finalise the row. Default 60s. */
  readonly timeout?: number;
  /** The failure line — say what a miss MEANS for this journey. */
  readonly message?: string;
}

/**
 * The negative twin of `expectStoredAssistantAnswer`: require the STORED
 * assistant row for this turn to be flagged `metadata.is_error === true`.
 *
 * For a turn the admission gates forward but the runtime cannot execute — a
 * profile it does not support, not one it finds malformed — the START POST
 * still answers 200 and a stream still opens; the refusal is decided later
 * and lands as an assistant row carrying `metadata.is_error: true` rather
 * than as any status code a Playwright `waitForResponse` could see. That is
 * exactly the shape `chat.agent-tools.spec.ts`'s own header comment measured
 * for an unsupported internal tool, and it is the shape
 * `chat.variables.spec.ts` measures for a populated `meta.variables` — see
 * that file's header for the runtime source this pins.
 *
 * Polled, not read once, for the same reason `expectStoredAssistantAnswer`
 * is: the stream settles in the browser before the store finalises the row,
 * so a single read can land between the row's creation and the write that
 * flags it, and report "not an error" about a row that is still being
 * written rather than about the turn's real outcome.
 *
 * A caller that wants the refused row's own text (usually empty — see the
 * `chat.agent-tools.spec.ts` note above) should read it separately with
 * `readStoredTranscript`; this helper only answers the yes/no question its
 * name asks.
 */
export async function expectStoredTurnRefusal(
  page: Page,
  projectId: string,
  conversationId: string | number,
  options: StoredTurnRefusalOptions = {},
): Promise<void> {
  const {
    timeout = 60_000,
    message = 'the turn was admitted but the runtime never stored a refusal for it',
  } = options;

  await expect
    .poll(
      async () => {
        const stored = await page.request.get(
          `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${String(conversationId)}`,
        );
        if (!stored.ok()) return false;
        const body = (await stored.json()) as {
          items?: readonly { role?: string; metadata?: { is_error?: boolean } }[];
        };
        const assistant = body.items?.find((item) => item.role === 'assistant');
        return assistant?.metadata?.is_error === true;
      },
      { timeout, message },
    )
    .toBe(true);
}

/** One persisted `chat_message_group`, as the transcript route serves it. */
export interface StoredTranscriptRow {
  /** `chat_message_group.id` — the numeric key. */
  readonly id: string;
  /** `chat_message_group.uuid` — the identity a regeneration REUSES (see `chat.regenerate.spec.ts`). */
  readonly uid: string;
  /** `user` for a question, `assistant` for every other author (the route maps `entity_name` this way). */
  readonly role: string;
  /** `string_agg` of the group's `text_message` items, in `order_index` order. */
  readonly content: string;
  /** `metadata.is_error` — a refused turn is STORED as an assistant row, so this is what tells an answer from a refusal. */
  readonly isError: boolean;
  /**
   * `chat_message_group.meta`, verbatim.
   *
   * Carried because one of its keys is the only witness a regeneration leaves:
   * `execution_generation` is rewritten to the run's own id by
   * `ResetCurrentAgentResponse`, while the row keeps its `id`, `uid` and
   * `created_at`. Row identity alone cannot tell "re-ran in place" from "left
   * untouched"; this can.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * The whole stored transcript of one conversation, oldest row first.
 *
 * `expectStoredAssistantAnswer` above answers "did the newest answer land";
 * this answers "what is the conversation now", which is the only way to state
 * that a second turn ACCUMULATED (`chat.multiturn.spec.ts`) or that a
 * regeneration REPLACED rather than appended (`chat.regenerate.spec.ts`).
 *
 * `sort_order=asc` is not cosmetic. The route's documented default is
 * `created_at DESC` (`parseMessagesQuery`, #603), so a caller that omits it
 * gets the transcript BACKWARDS and an "in order" assertion written against it
 * passes on a reversed conversation. `limit` is explicit for the same class of
 * reason: the default window is 50 groups, which is silently a filter.
 *
 * A non-2xx THROWS, naming the status and body. Returning `[]` would make a
 * broken route and an empty conversation indistinguishable — the exact shape
 * defect #599 took inside this very endpoint, where a failing query answered a
 * successful empty transcript and nobody saw a failure to investigate.
 */
export async function readStoredTranscript(
  page: Page,
  projectId: string,
  conversationId: string | number,
): Promise<readonly StoredTranscriptRow[]> {
  const url =
    `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${String(conversationId)}` +
    '?sort_order=asc&limit=100';
  const response = await page.request.get(url);
  if (!response.ok()) {
    throw new Error(
      `readStoredTranscript: GET ${url} -> ${response.status()} ${response.statusText()}\n` +
      `${(await response.text()).slice(0, 300)}`,
    );
  }
  const body = (await response.json()) as {
    items?: readonly {
      id?: string;
      uid?: string;
      role?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }[];
  };
  return (body.items ?? []).map((item) => ({
    id: String(item.id ?? ''),
    uid: String(item.uid ?? ''),
    role: item.role ?? '',
    content: item.content ?? '',
    isError: item.metadata?.['is_error'] === true,
    metadata: item.metadata ?? {},
  }));
}

/** The newest stored assistant row, as `chat.stop.spec.ts` measures it. */
export interface StoredAssistantAnswer {
  /** `true` when the conversation holds an assistant row at all. */
  readonly found: boolean;
  /** The row's concatenated text. Empty while the store is still filling. */
  readonly content: string;
  /** `metadata.is_error` — a refused turn is stored AS an assistant row. */
  readonly isError: boolean;
}

/**
 * READ the newest stored assistant row. Does not assert anything about it.
 *
 * `expectStoredAssistantAnswer` above answers a yes/no question and swallows
 * the value inside its own poll, which is exactly what a growth measurement
 * cannot use: proving a cancelled turn STOPPED writing needs the same field
 * read twice, a gap apart, and the two lengths compared. A second
 * `expect.poll` cannot express that — a poll that waits for two equal reads
 * also passes on a stream that has merely paused between chunks, and one that
 * waits for a stable value passes trivially the moment the turn finishes on
 * its own.
 *
 * The newest row, not the first in document order: the route's documented
 * default sort is `created_at DESC` (#603), so `items[0]` of role `assistant`
 * is the reply to the most recent question. `expectStoredAssistantAnswer`
 * reads the same route the same way, so the two cannot disagree about which
 * row they are talking about.
 *
 * A non-2xx returns `found: false` rather than throwing: the caller polls this
 * while a turn is still being admitted, and the transcript route can answer
 * before the response row exists. The CALLER's poll message says what a
 * permanent miss means for its own journey.
 */
export async function readStoredAssistantAnswer(
  page: Page,
  projectId: string,
  conversationId: string | number,
): Promise<StoredAssistantAnswer> {
  const response = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${String(conversationId)}`,
  );
  if (!response.ok()) return { found: false, content: '', isError: false };
  const body = (await response.json()) as {
    items?: readonly { role?: string; content?: string; metadata?: { is_error?: boolean } }[];
  };
  const assistant = (body.items ?? []).find((item) => item.role === 'assistant');
  if (assistant === undefined) return { found: false, content: '', isError: false };
  return {
    found: true,
    content: assistant.content ?? '',
    isError: assistant.metadata?.is_error === true,
  };
}
