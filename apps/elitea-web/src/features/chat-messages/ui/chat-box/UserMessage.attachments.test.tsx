/**
 * Pins the attachment download path a `UserMessage` row exposes.
 *
 * Two defects lived here together: `NormalAttachment`'s artifact-storage
 * branch requires a `projectId` nothing threaded down (so every
 * storage-backed download refused), and its refusal went to an `onError`
 * nobody supplied (so the refusal was invisible). Clicking download did
 * nothing at all. These cases fail against either half missing: the first
 * proves a threaded `projectId` reaches the real artifact fetch, the second
 * proves a failure surfaces as an inline `role="alert"` (the same pattern
 * `pages/agents/EditApplication.tsx` uses — this app has no toast
 * infrastructure).
 *
 * Harness: same `QueryClientProvider` + MSW ingredients as the sibling
 * `UserMessage.test.tsx` (the row's `useGetCurrentAuthor` query), plus the
 * runtime-config + artifact-endpoint setup from
 * `features/chat-input/ui/ImageAttachment.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { artifactContentOk } from '@/test/msw/handlers/artifacts';
import type { CapturedArtifactsRequest } from '@/test/msw/handlers/artifacts';

import { server } from '../../../../test/setup';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { UserMessage } from './UserMessage';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(): void {
  globals['elitea_ui_config'] = {
    vite_server_url: '/api/v2',
    vite_base_uri: '/',
    vite_public_project_id: '1',
  };
  resetConfigForTests();
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
  vi.restoreAllMocks();
});

/** A user message carrying one storage-backed, non-image attachment (`item_details.filepath` set, real bucket — `planAttachmentDownload`'s artifact-storage branch). */
const MESSAGE_WITH_ATTACHMENT = {
  id: 'q1',
  role: 'user',
  name: 'Alice',
  content: 'here is the file',
  createdAt: '2026-08-29T10:00:00Z',
  messageItems: [
    {
      item_type: 'attachment_message',
      uuid: 'att-1',
      item_details: {
        name: 'report.pdf',
        filepath: '/my-bucket/folder/report.pdf',
        bucket: 'my-bucket',
        attachment_type: 'document',
      },
    },
  ],
} as unknown as ChatMessage;

function renderMessage(projectId: string | undefined): void {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(http.get(`${BASE}/social/author`, () => HttpResponse.json({ id: 'me', name: 'Alice' })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <UserMessage message={MESSAGE_WITH_ATTACHMENT} messageId="q1" projectId={projectId} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function clickDownload(): void {
  fireEvent.mouseEnter(screen.getByTestId('chat-artifact-file-card'));
  fireEvent.click(screen.getByLabelText('Download attachment'));
}

describe('UserMessage attachment download', () => {
  it('fetches a storage-backed attachment through the threaded projectId', async () => {
    setConfig();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactContentOk(sink));

    renderMessage('p1');
    clickDownload();

    await waitFor(() => {
      expect(sink.length).toBe(1);
    });
    const request = sink[0];
    if (request === undefined) throw new Error('unreachable');
    expect(new URL(request.url).pathname).toBe('/api/v2/artifacts/objects/p1/my-bucket/folder/report.pdf');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a refused download as an inline alert instead of a silent no-op', async () => {
    // No projectId threaded — `NormalAttachment`'s storage branch refuses.
    // Before the fix that refusal went to an absent `onError` and the click
    // did literally nothing.
    setConfig();
    renderMessage(undefined);
    clickDownload();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Failed to download file from storage');
  });
});
