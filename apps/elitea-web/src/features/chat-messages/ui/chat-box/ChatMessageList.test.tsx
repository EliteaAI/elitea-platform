/**
 * Pins the `projectId` threading `ChatMessageList` owes each `UserMessage`
 * row's attachment cards.
 *
 * The row-level behaviour is pinned by `UserMessage.attachments.test.tsx`;
 * this case exists because the original defect was WIRING, not behaviour —
 * `ChatMessageList` mounted `UserMessage` with neither `projectId` nor an
 * error surface, so every storage-backed download refused silently even
 * though both endpoints of the chain were individually correct. A test of
 * either endpoint alone cannot see that (same class as `ChatBoxInputSlots.
 * test.tsx`'s slot-builder rationale), so this one drives the download
 * through the LIST and asserts the artifact fetch really happens.
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
import { ChatMessageList } from './ChatMessageList';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const globals = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
  vi.restoreAllMocks();
});

const USER_MESSAGE_WITH_ATTACHMENT = {
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

describe('ChatMessageList attachment download threading', () => {
  it('threads projectId to the user row so a storage-backed download really fetches', async () => {
    globals['elitea_ui_config'] = {
      vite_server_url: '/api/v2',
      vite_base_uri: '/',
      vite_public_project_id: '1',
    };
    resetConfigForTests();
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/social/author`, () => HttpResponse.json({ id: 'me', name: 'Alice' })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    // jsdom implements neither smooth scrolling nor layout; the list's
    // bottom-anchor effect calls this unconditionally on mount.
    Element.prototype.scrollIntoView = vi.fn();
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactContentOk(sink));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
          <ChatMessageList chatHistory={[USER_MESSAGE_WITH_ATTACHMENT]} projectId="p1" />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByTestId('chat-artifact-file-card'));
    fireEvent.click(screen.getByLabelText('Download attachment'));

    await waitFor(() => {
      expect(sink.length).toBe(1);
    });
    const request = sink[0];
    if (request === undefined) throw new Error('unreachable');
    expect(new URL(request.url).pathname).toBe('/api/v2/artifacts/objects/p1/my-bucket/folder/report.pdf');
  });
});
