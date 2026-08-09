/**
 * Journey 12: Attach a file <5 MiB (JRNY-012)
 * Journey 13: Attach a file >5 MiB chunked with progress (JRNY-013)
 * Journey 26: Socket disconnect → sidebar indicator → reconnect → rooms rejoined (JRNY-026)
 *
 * Spec §8.5 acceptance (from parity/manifest/chat.json JRNY-012/013/026).
 *
 * Every assertion below is anchored to something a stubbed route cannot
 * produce: the attach control's real accessible name, the capacity counter
 * the component computes from its own attachment state, the multipart FIELD
 * LAYOUT of the upload request, the bytes read back out of object storage
 * afterwards, and the status codes + JSON bodies elitea-main really returns
 * (202 chunk ack / 201 final array).
 *
 * PRODUCT GAPS deliberately NOT asserted around (verified 2026-08-08):
 *  - There is no pre-send attachment preview: ChatBox never passes
 *    `slots.attachmentList`, so `normalizeUserInputProps` renders null.
 *    The only pre-send signals the product emits are the attach button's
 *    tooltip counter and its disabled state — this file asserts those.
 *  - Upload PROGRESS PERCENT is dead in the chat page. `UserInputFooter`
 *    renders `<UploadProgressIndicator progress={isUploading ? uploadProgress
 *    : undefined}>`, but ChatBox.tsx never passes an `attachments` prop to
 *    NewChatInput carrying `isUploading`/`uploadProgress` (it passes only
 *    `{attachments, onAttachFiles}` for the button, ChatBox.tsx:374), so the
 *    determinate variant with its `aria-valuenow` + "<n>%" label can never
 *    render here. Chunk-level progress is therefore asserted through the
 *    wire protocol (two chunk requests, 202 then 201) instead of the UI.
 *  - Uploaded attachments never appear in the transcript: the optimistic
 *    user message carries no attachments and elitea-main does not persist a
 *    `chat_messages_attachment` row (see conversations/attachments.go), so
 *    `chat-artifact-file-card` is unassertable end-to-end.
 *  - Attachment rejection produces no UI at all (AttachmentButton's `onError`
 *    is never supplied by ChatBoxInputSlots), so there is no negative path.
 *
 * APP DEFECT found while writing this file — deep-linking a conversation
 * crashes the chat route, so these journeys drive `/app/chat` and let the
 * send create the conversation (which is the real JRNY-012 flow anyway):
 * GET /elitea_core/messages/... returns `{items,total,page,...}`, but
 * src/pages/chat/useChatPageData.ts:75 handles only `rows`/bare-array and
 * passes the paging OBJECT as `message_groups`; convertMessagesToChatHistory
 * then does `[...(messageGroups ?? [])]` and throws
 * "(e ?? []) is not iterable" into the error boundary.
 */
import { test, expect } from '@playwright/test';
import type { Request } from '@playwright/test';
import path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { API_BASE, DEFAULT_PROJECT_ID, deleteConversation } from '../../fixtures/api';

/** Exact accessible name of the attach control (AttachmentButton.tsx:147 + en.json:759). */
const ATTACH_NAME = 'attach files';
/** MAX_ATTACHMENTS (src/shared/lib/attachments.ts). */
const MAX_ATTACHMENTS = 10;
/** CHUNK_SIZE (src/shared/api/upload.ts:22). */
const CHUNK_SIZE = 5 * 1024 * 1024;

const uploadUrlRe = new RegExp(`/elitea_core/attachments/prompt_lib/${DEFAULT_PROJECT_ID}/(\\d+)$`);

/**
 * The AttachmentButton's OWN hidden input — scoped to the button's own
 * container (button < Tooltip span < the footer div that also holds the
 * input), not to any file input that happens to exist on the shell.
 */
function attachInput(page: import('@playwright/test').Page) {
  return page
    .getByRole('button', { name: ATTACH_NAME, exact: true })
    .locator('xpath=ancestor::div[1]')
    .locator('input[type="file"]');
}

/** Types a question and sends it. Send stays disabled while the question is empty. */
async function send(page: import('@playwright/test').Page, question: string): Promise<void> {
  await page.getByTestId('chat-message-input').click();
  await page.keyboard.type(question);
  const sendButton = page.getByTestId('chat-send-button');
  await expect(sendButton).toBeVisible();
  await sendButton.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey 12: Attach a small file (<5 MiB)
// ─────────────────────────────────────────────────────────────────────────────
test('J12: attach a small file to a chat message', async ({ page }) => {
  const tmpFile = path.join(os.tmpdir(), 'e2e-small-file-attach.txt');
  // ASCII only: the stored object is read back as raw bytes and decoded as
  // latin1, so a non-ASCII byte would not round-trip through the comparison.
  const contents = 'E2E test attachment content - small file.';
  fs.writeFileSync(tmpFile, contents);
  const byteLength = Buffer.byteLength(contents);
  let createdConversationId: string | undefined;

  try {
    await page.goto(BASE_URL + '/app/chat');

    // The attach control, by its one stable handle: its accessible name.
    const attach = page.getByRole('button', { name: ATTACH_NAME, exact: true });
    await expect(attach).toBeEnabled({ timeout: 20_000 });

    await checkA11y(page);

    // Capacity counter BEFORE attaching — computed by
    // getRemainingAttachmentCapacity from the component's own state.
    await attach.hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${MAX_ATTACHMENTS} files left`);

    // The hidden input is the button's own sibling inside the chat input.
    const input = attachInput(page);
    await expect(input).toHaveCount(1);
    await input.setInputFiles(tmpFile);

    // The file really entered attachment state: remaining capacity drops by one.
    // A build that swallowed the picked file keeps reporting 10.
    await page.mouse.move(2, 2);
    await attach.hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${MAX_ATTACHMENTS - 1} files left`);

    // Arm the upload watcher BEFORE sending: the send creates the conversation
    // over REST first, then uploads into it (resolveConversationForSend →
    // uploadPendingAttachments). The multipart body is only retained for
    // INTERCEPTED requests, so capture it in a pass-through route handler.
    const uploads: Array<{ readonly request: Request; readonly body: string }> = [];
    await page.route(/\/elitea_core\/attachments\/prompt_lib\//, async (route) => {
      const r = route.request();
      uploads.push({ request: r, body: r.postDataBuffer()?.toString('latin1') ?? '' });
      await route.continue();
    });

    await send(page, 'autotest_attach small file journey');

    // Exactly ONE upload request: a <5 MiB file takes the single-shot path.
    await expect.poll(() => uploads.length, { timeout: 30_000 }).toBe(1);
    const { request: req, body } = uploads[0]!;
    expect(req.url()).toMatch(uploadUrlRe);
    const convId = uploadUrlRe.exec(req.url())?.[1];
    expect(convId).toMatch(/^\d+$/);
    createdConversationId = convId;

    // Single-shot multipart body (upload.ts uploadSmallFile): `file` +
    // `overwrite_attachments=1`, and NO chunk fields — this file is under
    // CHUNK_SIZE, so a regressed threshold would show up as chunk_index here.
    expect(body).toContain('name="overwrite_attachments"');
    expect(body).toContain('filename="e2e-small-file-attach.txt"');
    expect(body).not.toContain('name="chunk_index"');

    // The server round trip: 201 + [{filepath, file_size}] (attachments.go).
    const resp = await req.response();
    expect(resp).not.toBeNull();
    expect(resp!.status()).toBe(201);
    const uploaded = (await resp!.json()) as Array<{ filepath?: unknown; file_size?: unknown }>;
    expect(Array.isArray(uploaded)).toBe(true);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.filepath).toBe(`/chat-attachments/${convId}/e2e-small-file-attach.txt`);
    expect(uploaded[0]!.file_size).toBe(byteLength);

    // BYTE IDENTITY — the bytes STORED are the bytes CHOSEN.
    //
    // This used to be `expect(body).toContain(contents)` on the captured
    // multipart body. That is not portable: chromium exposes the whole encoded
    // body through CDP, but WebKit surfaces only the part HEADERS — the
    // received body there is literally
    //   `…name="file"; filename="e2e-small-file-attach.txt"\r\n
    //    Content-Type: text/plain\r\n\r\n\r\n--…`
    // with an EMPTY payload between the blank line and the next boundary,
    // because the File/Blob part is never read back into the protocol message.
    // The app sends the bytes on both engines; only Playwright's view differs.
    //
    // So the guarantee moves one hop further out, where it is stronger and
    // engine-independent: read the object back out of storage and compare
    // bytes. `file_size` above pins the LENGTH, this pins the CONTENT — a
    // build that uploaded a same-length wrong buffer passes the former and
    // fails this. Key layout from finalizeAttachment (conversations/
    // attachments.go:433) — bucket `chat-attachments`, key `<convId>/<name>`.
    const stored = await page.request.get(
      `${API_BASE}/artifacts/objects/${DEFAULT_PROJECT_ID}/chat-attachments/${convId}/e2e-small-file-attach.txt`,
    );
    expect(stored.status()).toBe(200);
    expect((await stored.body()).toString('latin1')).toBe(contents);

    // The send went through: the question is in the transcript.
    await expect(page.getByTestId('chat-message-list')).toContainText('autotest_attach small file journey');
  } finally {
    fs.unlinkSync(tmpFile);
    if (createdConversationId !== undefined) {
      await deleteConversation(page.request, createdConversationId).catch(() => undefined);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 12b: the client-side attachment limit is really enforced
// ─────────────────────────────────────────────────────────────────────────────
test('J12b: attaching MAX_ATTACHMENTS files disables further attachment', async ({ page }) => {
  const files: string[] = [];
  for (let i = 0; i < MAX_ATTACHMENTS; i++) {
    const p = path.join(os.tmpdir(), `e2e-cap-attach-${i}.txt`);
    fs.writeFileSync(p, `capacity probe ${i}`);
    files.push(p);
  }

  try {
    await page.goto(BASE_URL + '/app/chat');
    const attach = page.getByRole('button', { name: ATTACH_NAME, exact: true });
    await expect(attach).toBeEnabled({ timeout: 20_000 });

    await attachInput(page).setInputFiles(files);

    // isAtMaxCapacity → both the button and its input go disabled, and the
    // tooltip switches to the max-attachments string.
    await expect(attach).toBeDisabled();
    await expect(attachInput(page)).toBeDisabled();
    await attach.hover({ force: true });
    await expect(page.getByRole('tooltip')).toHaveText(`Max ${MAX_ATTACHMENTS} attachments`);

    await checkA11y(page);
  } finally {
    for (const f of files) fs.unlinkSync(f);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 13: Attach a large file (>5 MiB, chunked with progress)
// ─────────────────────────────────────────────────────────────────────────────
test('J13: attach a large file chunked upload with progress', async ({ page }) => {
  const tmpFile = path.join(os.tmpdir(), 'e2e-large-file-attach.bin');
  const SIX_MIB = 6 * 1024 * 1024;
  fs.writeFileSync(tmpFile, Buffer.alloc(SIX_MIB, 0xab));
  let createdConversationId: string | undefined;

  try {
    const chunkRequests: Request[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && uploadUrlRe.test(r.url())) chunkRequests.push(r);
    });

    await page.goto(BASE_URL + '/app/chat');
    const attach = page.getByRole('button', { name: ATTACH_NAME, exact: true });
    await expect(attach).toBeEnabled({ timeout: 20_000 });

    await checkA11y(page);

    await attachInput(page).setInputFiles(tmpFile);
    await attach.hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${MAX_ATTACHMENTS - 1} files left`);

    await send(page, 'autotest_attach large file journey');

    // 6 MiB / CHUNK_SIZE(5 MiB) = exactly 2 chunk POSTs (createFileChunks).
    // A regressed CHUNK_SIZE, or a build that stopped chunking, yields 1.
    // Settles at exactly 2 and STAYS there — a third request (e.g. a retry
    // loop, or a chunk splitter that over-slices) would break the protocol
    // just as badly as one request, and `poll` alone would not notice.
    await expect.poll(() => chunkRequests.length, { timeout: 60_000 }).toBe(Math.ceil(SIX_MIB / CHUNK_SIZE));
    await page.waitForTimeout(1_000);
    expect(chunkRequests).toHaveLength(2);

    const [first, second] = chunkRequests as [Request, Request];
    expect(first.url()).toBe(second.url());
    expect(first.url()).toMatch(uploadUrlRe);
    const convId = uploadUrlRe.exec(first.url())?.[1];
    expect(convId).toMatch(/^\d+$/);
    createdConversationId = convId;

    // Intermediate chunk → 202 in-progress ack. Its body echoes the very form
    // fields the client sent (chunk_index / total_chunks / file_id), which is
    // how this asserts the chunk protocol: Playwright does not retain the
    // multipart body of a 5 MiB request, so the echo is the evidence.
    const firstResp = await first.response();
    expect(firstResp).not.toBeNull();
    expect(firstResp!.status()).toBe(202);
    const ack = (await firstResp!.json()) as Record<string, unknown>;
    expect(ack['status']).toBe('chunk_received');
    expect(ack['chunk_index']).toBe(0);
    expect(ack['total_chunks']).toBe(2);
    expect(ack['file_id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Final chunk → 201 with the assembled file: full 6 MiB, not one chunk.
    const secondResp = await second.response();
    expect(secondResp).not.toBeNull();
    expect(secondResp!.status()).toBe(201);
    const uploaded = (await secondResp!.json()) as Array<{ filepath?: unknown; file_size?: unknown }>;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.filepath).toBe(`/chat-attachments/${convId}/e2e-large-file-attach.bin`);
    expect(uploaded[0]!.file_size).toBe(SIX_MIB);
  } finally {
    fs.unlinkSync(tmpFile);
    if (createdConversationId !== undefined) {
      await deleteConversation(page.request, createdConversationId).catch(() => undefined);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Journey 26: Socket disconnect → sidebar indicator → reconnect → rooms rejoined
// ─────────────────────────────────────────────────────────────────────────────
//
// JRNY-026 CANNOT BE COVERED END-TO-END IN THIS STACK, and this test does not
// pretend otherwise. The E2E deployment serves /app/config.js with
// `vite_socket_server: ""`, so AppProviders installs createNoopSocketClient:
// its connection state is hardcoded 'disconnected', emit/on/off are no-ops, no
// room is ever joined, and therefore nothing can be rejoined. The previous
// version of this test drove `window.__elitea_socket`, which is assigned
// nowhere in src — both "disconnect" and "reconnect" steps were no-ops, and
// the acceptance was two identical toBeVisible() calls.
//
// What IS assertable — and asserted below — is that the indicator reports the
// real connection state rather than merely existing. The disconnect →
// indicator → reconnect → rejoin acceptance needs a socket server in
// deploy/docker-compose.e2e-standalone.yml; until then it lives at the unit
// level (shared/api/socket/client.test.ts, rooms.test.ts).
//
// Tracked as #152, which also records WHY this is not the env-var fix it looks
// like: `services/elitea-main/internal/api/socketio/server.go` has zero callers
// (`socketio.NewServer` is never constructed, `Handler()` never mounted), so
// there is no server to point VITE_SOCKET_SERVER at.
test('J26: sidebar connection indicator reports the real socket state', async ({ page }) => {
  // Pin the precondition: this stack genuinely has no socket server. When one
  // is added, this assertion fails and this journey must be rewritten to the
  // full disconnect/reconnect acceptance instead of quietly passing.
  const cfg = await page.request.get(`${BASE_URL}/app/config.js`);
  expect(cfg.status()).toBe(200);
  expect(await cfg.text()).toContain('vite_socket_server: ""');

  await page.goto(BASE_URL + '/app/chat');

  // The dot's state is carried by its accessible name (MUI Tooltip title →
  // aria-label on the child), not by its visibility.
  const connectionDot = page.getByTestId('sidebar-connection-dot');
  await expect(connectionDot).toHaveAttribute('aria-label', 'Disconnected', { timeout: 20_000 });

  await checkA11y(page);
});
