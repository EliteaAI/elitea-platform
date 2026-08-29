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
        return assistant?.content ?? '';
      },
      { timeout, message },
    )
    .toMatch(pattern);
}

/** Escape a literal so `contains` above can be embedded in a RegExp unchanged. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
