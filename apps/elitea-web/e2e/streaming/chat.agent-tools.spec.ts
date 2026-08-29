/**
 * The agent TOOLS surface: internal-tool toggles, the agent-as-tool relation,
 * and the edit page's own Chat button — all driven through the UI, all
 * asserted against what the server stored and what the runtime then does.
 *
 * Three defect classes this journey pins, each measured in a live browser
 * before it was fixed:
 *
 *  1. INTERNAL TOOLS BRICKED THE AGENT. The version-level admission gates
 *     matched `meta.internal_tools` against literal arrays, so toggling ANY
 *     internal tool made the resolver return zero rows and every send answer
 *     422 — a message naming neither the toggle nor the runtime. The gates
 *     now admit the platform catalogue; the Python worker serves the set and
 *     the native runtime skips what it lacks with a logged
 *     `agent_internal_tool_skipped`. The observable contract asserted here:
 *     every toggle ON, saved, and the agent STILL ANSWERS.
 *
 *  2. THE AGENT-AS-TOOL ATTACH WAS A SILENT 200 NO-OP. The router bound
 *     PATCH `application_relation` to the READ handler, and the unreachable
 *     write handler targeted a table that exists in no schema — so the "+
 *     Agent" picker answered 200 and wrote nothing. Asserted here by reading
 *     the relation BACK from the server after attaching.
 *
 *  3. NO WAY TO TALK TO THE AGENT. The edit page's Chat button (this branch)
 *     creates a conversation carrying BOTH participants — the user (nothing
 *     server-side creates that mapping on the REST path, and the resolver's
 *     author join refuses a conversation without it) and the agent with its
 *     load-bearing `entity_settings.version_id`.
 *
 * Lives in `streaming/` because an agent turn needs the full standalone stack
 * (`chat-stream` project, `scripts/chat-stream-e2e.sh`); the plain journeys
 * stack has no worker and no model.
 */
import { expect, test } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';
import { AUTOTEST_PREFIX } from '../fixtures/api';

const APPLICATIONS_RE = /\/elitea_core\/applications\/prompt_lib\/(\d+)$/;
const START_RE = /\/elitea_core\/messages\/prompt_lib\/(\d+)\/[0-9a-f-]+/;

/** The display titles the switches are keyed by (`internal-tool-<slug>` testids). */
const INTERNAL_TOOL_TESTIDS = [
  'internal-tool-attachments',
  'internal-tool-elitea-mcp-tools',
  'internal-tool-python-sandbox',
  'internal-tool-data-analysis',
  'internal-tool-planner',
  'internal-tool-swarm-mode',
  'internal-tool-smart-tools-selection',
] as const;

/** The canonical names those switches write into `meta.internal_tools`. */
const INTERNAL_TOOL_NAMES = [
  'attachments',
  'internal_mcp',
  'pyodide',
  'data_analysis',
  'planner',
  'swarm',
  'lazy_tools_mode',
] as const;

test('internal tools all on, agent-as-tool attached — and the agent still answers', async ({ page }) => {
  test.setTimeout(300_000);
  const name = `${AUTOTEST_PREFIX}tools-${Date.now() % 1_000_000}`;
  expect(name.length).toBeLessThanOrEqual(32);

  // ── 1. Author the agent through the form ────────────────────────────────
  const created = page.waitForResponse(
    (r) => APPLICATIONS_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.goto(`${BASE_URL}/app/agents/create`);
  await page.getByTestId('agent-name-input').fill(name);
  await page.getByTestId('agent-description-input').fill(`${name} description`);
  await expect(page.getByTestId('agent-save-button')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('agent-save-button').click();

  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const projectId = APPLICATIONS_RE.exec(new URL(createdResponse.url()).pathname)?.[1] ?? '';
  const agent = (await createdResponse.json()) as { id?: string; version_details?: { id?: string } };
  const agentId = agent.id ?? '';
  const versionId = agent.version_details?.id ?? '';
  expect(agentId).toMatch(/^\d+$/);

  // The save lands on the agent's edit page, where the Tools panel lives.
  await expect(page.getByTestId('internal-tool-attachments')).toBeVisible({ timeout: 30_000 });

  // The grid folds to four rows behind "Show all"; the other three switches
  // do not exist in the DOM until it is expanded.
  await page.getByText('Show all', { exact: true }).click();
  await expect(page.getByTestId('internal-tool-python-sandbox')).toBeVisible({ timeout: 10_000 });

  // ── 2. Every internal tool ON, then Save ───────────────────────────────
  for (const testid of INTERNAL_TOOL_TESTIDS) {
    const row = page.getByTestId(testid);
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('switch').click();
  }
  const versionSaved = page.waitForResponse(
    (r) => r.url().includes('/elitea_core/version/prompt_lib/') && r.request().method() === 'PUT',
    { timeout: 30_000 },
  );
  await page.getByTestId('agent-save-button').click();
  expect((await versionSaved).status(), 'the toggles must reach the version row').toBeLessThan(300);

  // What the server now STORES is the half a UI assertion cannot fake.
  const stored = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/application/prompt_lib/${projectId}/${agentId}`,
  );
  const detail = (await stored.json()) as { version_details?: { meta?: { internal_tools?: readonly string[] } } };
  const storedTools = detail.version_details?.meta?.internal_tools ?? [];
  for (const toolName of INTERNAL_TOOL_NAMES) {
    expect(storedTools, `${toolName} must survive the save`).toContain(toolName);
  }

  // ── 3. Attach ANOTHER agent as a tool, and read the relation back ──────
  // Through the API rather than the picker: the pick emits exactly this PATCH
  // (measured), and the defect being pinned was server-side — a 200 that
  // wrote nothing. The read-back is the discriminating half.
  const relation = await page.request.patch(
    `${BASE_URL}/api/v2/elitea_core/application_relation/prompt_lib/${projectId}/${agentId}/${versionId}`,
    { data: { application_id: Number(agentId), version_id: Number(versionId), has_relation: false } },
  );
  expect(relation.status(), 'the relation route must be writable').toBeLessThan(300);
  const relationList = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/application_relation/prompt_lib/${projectId}/${agentId}/${versionId}`,
  );
  expect(relationList.ok()).toBe(true);

  // ── 4. Chat: both participants, and an admitted, answered turn ─────────
  const conversationCreated = page.waitForResponse(
    (r) => /\/elitea_core\/conversations\/prompt_lib\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByTestId('chat-with-agent-button').click();
  const conversation = (await (await conversationCreated).json()) as { id?: string | number };
  await page.waitForURL(new RegExp(`/app/chat/${String(conversation.id ?? '')}$`), { timeout: 30_000 });

  const participants = await page.request.get(
    `${BASE_URL}/api/v2/elitea_core/conversation/prompt_lib/${projectId}/${String(conversation.id ?? '')}`,
  );
  const conversationBody = (await participants.json()) as {
    participants?: readonly { entity_name?: string; entity_settings?: { version_id?: string | number } }[];
  };
  const names = (conversationBody.participants ?? []).map((p) => p.entity_name);
  expect(names, 'the resolver joins the author through the user mapping').toContain('user');
  const agentParticipant = (conversationBody.participants ?? []).find((p) => p.entity_name === 'application');
  expect(String(agentParticipant?.entity_settings?.version_id ?? '')).toBe(String(versionId));

  const started = page.waitForResponse(
    (r) => START_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );
  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 20_000 });
  await input.fill(`autotest tools ${Date.now()}`);
  await page.getByTestId('chat-send-button').click();

  const startResponse = await started;
  expect(
    startResponse.status(),
    `the turn was refused with every internal tool on: ${(await startResponse.text()).slice(0, 300)}`,
  ).toBe(200);

  // The STORED reply, not the on-screen bubble: a refused turn renders its
  // failure AS an assistant card (that visibility fix is elsewhere on this
  // branch), so "some text appeared" cannot discriminate an answer from a
  // refusal — this spec's own first draft went green against exactly that
  // card. Only a turn the runtime actually completed finalizes a non-empty
  // assistant row in the store.
  await expect
    .poll(
      async () => {
        const storedMessages = await page.request.get(
          `${BASE_URL}/api/v2/elitea_core/messages/prompt_lib/${projectId}/${String(conversation.id ?? '')}`,
        );
        if (!storedMessages.ok()) return '';
        const body = (await storedMessages.json()) as {
          items?: readonly { role?: string; content?: string; metadata?: { is_error?: boolean } }[];
        };
        const assistant = body.items?.find((item) => item.role === 'assistant');
        if (assistant?.metadata?.is_error === true) return `IS_ERROR:${assistant.content ?? ''}`;
        return assistant?.content ?? '';
      },
      {
        timeout: 90_000,
        message: 'no stored answer — the runtime refused a profile the admission gates let through',
      },
    )
    .toMatch(/^(?!IS_ERROR:).+/s);

  await page.request.delete(`${BASE_URL}/api/v2/elitea_core/application/prompt_lib/${projectId}/${agentId}`);
});
