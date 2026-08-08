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
