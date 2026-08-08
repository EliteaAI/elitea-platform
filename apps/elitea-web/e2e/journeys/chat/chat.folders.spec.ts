/**
 * Journey 10: Create folder → drag conversation into it → reorder (JRNY-010)
 *
 * Spec §8.5 acceptance (from parity/manifest/chat.json JRNY-010).
 * Acceptance: the conversation is grouped under the folder and reordering
 * persists; the ordering survives a reload.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY PART OF THIS FILE IS RED, AND MUST STAY RED
 * ─────────────────────────────────────────────────────────────────────────
 * The previous version of this file passed by never testing anything: 12
 * escape hatches (test.skip, two early returns, four `.catch(() => false)`
 * downgrades, three `.or()` fallbacks and two unfalsifiable assertions)
 * meant a blank page satisfied it. Every hatch is gone. What is left are
 * unconditional assertions, three of which fail — each failure is a real,
 * measured product gap, not a test defect. Do NOT "fix" them by loosening
 * the assertion.
 *
 * Gap 1 — the conversation-list sidebar is never mounted (UI wiring gap).
 *   `src/features/chat-conversation-list` has no importer anywhere in src:
 *   its root export is index.ts:97 (`export { Conversations }`) and the only
 *   route that could host it, src/routes/_shell/chat.tsx, renders
 *   processes/chat → src/pages/chat/index.tsx → `<ChatBox>` only; ChatBox's
 *   import list (src/widgets/chat-box/ui/ChatBox.tsx:17-58) contains no
 *   conversation list. Measured against the running stack: /app/chat exposes
 *   exactly these testids — sidebar-toggle, sidebar-connection-dot,
 *   sidebar-create-button, sidebar-notification-button, sidebar-agent-hub-button,
 *   sidebar-collapse-toggle, chat-input, chat-message-input,
 *   model-selector-button, model-selector-name — and zero buttons matching
 *   /folder/i. So no folder UI exists to drive.
 *
 * Gap 2 — moving a conversation into a folder has no server-side effect.
 *   PUT /elitea_core/conversation/prompt_lib/{p}/{id} with `folder_id`
 *   returns 200 but the folder's `conversations` array stays [] and its
 *   `total` stays 0 in GET /elitea_core/folder/prompt_lib/{p}?grouped=true,
 *   and the conversation-details response carries no folder_id at all.
 *
 * Gap 3 — folder ordering is not modelled by the backend.
 *   PUT .../folder/prompt_lib/{p}/{id} with position/neighbor_above_id/
 *   neighbor_below_id (exactly the payload useReorderFolders.ts:79-97 sends)
 *   returns 200, but the response carries no `position` field and the list
 *   order is unaffected by it.
 *
 * What DOES work, and is asserted green below: folder create / list /
 * rename / delete round-trip through the real backend.
 *
 * Deliberately NOT asserted (no reachable selector exists yet, so an
 * assertion would be fiction rather than coverage): the folder-name field.
 * FolderItemEditor.tsx:87-97 renders StyledInputEnhancer with label="", no
 * placeholder and no data-testid, so it has no accessible name of any kind.
 * Naming a folder through the UI needs a `data-testid` added in src first.
 */
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { AUTOTEST_PREFIX, API_BASE, DEFAULT_PROJECT_ID, createConversation } from '../../fixtures/api';

/** Suffix unique to this spec file so concurrent agents' fixtures never collide. */
const SUFFIX = '-fold';
const uniq = (label: string): string =>
  `${AUTOTEST_PREFIX}${label}${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`;

const FOLDER_ROOT = `${API_BASE}/elitea_core/folder/prompt_lib/${DEFAULT_PROJECT_ID}`;
const CONVERSATION_ROOT = `${API_BASE}/elitea_core/conversation/prompt_lib/${DEFAULT_PROJECT_ID}`;

interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly total?: number;
  readonly conversations?: readonly { readonly id?: string; readonly name?: string }[];
}

/** POST a folder and return the server-assigned row. Throws on any non-201. */
async function createFolder(request: APIRequestContext, name: string): Promise<FolderRow> {
  const res = await request.post(FOLDER_ROOT, { data: { name } });
  expect(res.status(), `POST ${FOLDER_ROOT} body=${(await res.text()).slice(0, 300)}`).toBe(201);
  const body = (await res.json()) as FolderRow;
  expect(body.id, 'folder create must return a server-assigned id').toBeTruthy();
  return body;
}

/** GET the grouped folder listing — the exact call useFoldersListQuery makes. */
async function listFolders(request: APIRequestContext): Promise<readonly FolderRow[]> {
  const res = await request.get(`${FOLDER_ROOT}?grouped=true`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { folders?: readonly FolderRow[] };
  return body.folders ?? [];
}

/*
 * `test.fail()`, NOT `test.skip()`, and the difference is the whole point.
 *
 * A skip runs nothing and reports green — which is the exact defect this suite
 * was rewritten to remove. `test.fail()` runs every assertion below, expects the
 * run to fail, and turns the suite RED the moment it starts passing. So the gap
 * stays visible, the assertions keep their teeth, and nobody has to remember to
 * come back and re-enable anything: fixing the app breaks the build until the
 * annotation is removed.
 *
 * Blocked on #128 — the folder UI is not mounted. No composition root renders
 * <Conversations>; `grep -rn "chat-conversation-list" src` outside the slice
 * returns only doc comments, and no testid on /app/chat matches /folder/i.
 * There is no 'Create folder' button to click, so this cannot pass until the
 * component is wired.
 */
test('J10: the chat surface exposes the folder UI this journey needs', async ({ page }) => {
  test.fail();
  // Real fixture: a conversation that the journey would drag into a folder.
  const conversationName = uniq('folder-src');
  await createConversation(page.request, conversationName);

  await page.goto(BASE_URL + '/app/chat');
  await page.waitForURL('**/chat**', { timeout: 15_000 });

  // Single real selector — no .or() chain. src/features/chat-input/ui/
  // UserInputEditableArea.tsx:117 is the only element carrying this testid.
  await expect(page.getByTestId('chat-message-input')).toBeVisible({ timeout: 10_000 });

  await checkA11y(page);

  // RED — Gap 1. The exact aria-label the real control carries
  // (src/features/chat-conversation-list/ui/conversations/Conversations.header.tsx:137,
  // and the collapsed-rail twin at :59). No fallback, no skip: this is the
  // precondition for every remaining step of JRNY-010, and it is absent.
  const createFolderButton = page.getByRole('button', { name: 'Create folder' });
  await expect(createFolderButton, 'conversation-list sidebar is not mounted by any route — see Gap 1').toBeVisible({ timeout: 10_000 });
  await expect(createFolderButton).toBeEnabled();

  await createFolderButton.click();

  // The draft folder mounts FolderItem in edit mode (FolderItem.tsx:165,175).
  // Confirm is gated on isFolderNameValid (FolderItemEditor.tsx:103-124) — a
  // stub page cannot reproduce a control that is disabled purely because a
  // sibling field is empty.
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

test('J10: folder create/list/rename/delete round-trip through the backend', async ({ page }) => {
  const request = page.request;
  const name = uniq('crud');

  const created = await createFolder(request, name);
  expect(created.name).toBe(name);

  // Server-derived: the folder is addressable by the id the POST returned.
  const afterCreate = await listFolders(request);
  expect(afterCreate.map((f) => f.id)).toContain(created.id);
  expect(afterCreate.find((f) => f.id === created.id)?.name).toBe(name);

  // Rename persists — PUT is the same call useFolderUpdateMutation issues.
  const renamed = `${name}-renamed`;
  const put = await request.put(`${FOLDER_ROOT}/${created.id}`, { data: { name: renamed } });
  expect(put.status()).toBe(200);

  const afterRename = await listFolders(request);
  expect(afterRename.find((f) => f.id === created.id)?.name).toBe(renamed);

  // Delete removes it from the listing.
  const del = await request.delete(`${FOLDER_ROOT}/${created.id}`);
  expect(del.status()).toBe(204);

  const afterDelete = await listFolders(request);
  expect(afterDelete.map((f) => f.id)).not.toContain(created.id);
});

test('J10: a conversation moved into a folder is grouped under it', async ({ page }) => {
  // Expected-fail, blocked on #128 defect 1: PUT .../conversation/.../{id} with
  // folder_id returns 200, but the folder's `conversations` stays [] and
  // `total` stays 0. This is the literal JRNY-010 acceptance criterion. See the
  // note above the first test for why this is test.fail() and not test.skip().
  test.fail();
  const request = page.request;
  const conversationName = uniq('grouped-conv');
  const conversationId = await createConversation(request, conversationName);
  const folder = await createFolder(request, uniq('grouped'));

  // The move the drop handler performs: conversationApi.edit({ folder_id })
  // — useMoveToFolderConversation.hooks.ts:163.
  const move = await request.put(`${CONVERSATION_ROOT}/${conversationId}`, {
    data: { folder_id: folder.id },
  });
  expect(move.status()).toBe(200);

  // RED — Gap 2. This is the literal JRNY-010 acceptance ("the conversation
  // is grouped under the folder") and the backend does not implement it: the
  // PUT is accepted and then discarded.
  const folders = await listFolders(request);
  const row = folders.find((f) => f.id === folder.id);
  expect(row, `folder ${folder.id} missing from grouped listing`).toBeDefined();
  expect(
    (row?.conversations ?? []).map((c) => c.name),
    'conversation moved via folder_id is not returned under its folder — see Gap 2',
  ).toContain(conversationName);
  expect(row?.total, 'folder.total must count the moved conversation').toBeGreaterThan(0);
});

test('J10: folder reordering persists', async ({ page }) => {
  // Expected-fail, blocked on #128 defect 3: a PUT carrying position /
  // neighbor_above_id / neighbor_below_id — the exact payload
  // useReorderFolders.ts:79-97 sends — returns 200, the response carries no
  // `position`, and list order is unchanged. Ordering is not modelled at all.
  test.fail();
  const request = page.request;
  const first = await createFolder(request, uniq('order-a'));
  const second = await createFolder(request, uniq('order-b'));

  const orderOf = (folders: readonly FolderRow[]): readonly string[] =>
    folders.map((f) => f.id).filter((id) => id === first.id || id === second.id);

  // Move `second` above `first` with the exact payload useReorderFolders.ts:79-97 sends.
  const reorder = await request.put(`${FOLDER_ROOT}/${second.id}`, {
    data: {
      name: second.name,
      position: 0,
      neighbor_above_id: null,
      neighbor_below_id: first.id,
    },
  });
  expect(reorder.status()).toBe(200);

  // RED — Gap 3. "Reordering persists" means the listing order changed and
  // stays changed. Order comparison, not visibility: two fresh GETs.
  expect(orderOf(await listFolders(request)), 'reorder had no effect on list order — see Gap 3').toEqual([second.id, first.id]);
  expect(orderOf(await listFolders(request)), 'reordered order did not survive a refetch — see Gap 3').toEqual([second.id, first.id]);
});
