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
export const API_BASE = (process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8080') + '/api/v2';

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
  const resp = await request.post(
    `${API_BASE}/elitea_core/conversations/prompt_lib/${DEFAULT_PROJECT_ID}`,
    { data: { name } },
  );
  const body = await resp.json();
  return body.id as string;
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

/**
 * Create an agent (application) via API.
 * Returns the new agent id.
 */
export async function createAgent(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const resp = await request.post(
    `${API_BASE}/elitea_core/applications/prompt_lib/${DEFAULT_PROJECT_ID}`,
    {
      data: {
        name,
        description: `${AUTOTEST_PREFIX}e2e test agent`,
        type: 'agent',
        prompt: 'You are a helpful assistant.',
      },
    },
  );
  const body = await resp.json();
  return body.id as string;
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
