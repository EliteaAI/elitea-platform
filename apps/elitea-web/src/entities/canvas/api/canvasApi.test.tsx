/**
 * canvasApi.test.tsx — contract + hook coverage for `./canvasApi.ts`. Every
 * REST assertion goes through a real `eliteaFetch` call (MSW-mocked, no
 * `vi.mock()` of application code — R-M1), and `uploadAttachments` reuses
 * `shared/api/upload.ts`'s already-covered XHR path via its MSW handler
 * fixtures (`smallFileOk`/`uploadServerError`), asserted the same way
 * `upload.test.ts` asserts it.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { smallFileOk, uploadServerError } from '../../../test/msw/handlers/upload';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import {
  useCanvasDetailsQuery,
  useCreateCanvasMutation,
  useEditCanvasMutation,
  useRemoveAttachmentsMutation,
  useSetAttachmentStorageMutation,
  useUploadAttachmentsMutation,
} from './canvasApi';

const BASE = '/api/v2';
const ORIGIN = window.location.origin;

function createWrapper(): { wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useCanvasDetailsQuery', () => {
  it('stays disabled until projectId and id are both defined', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCanvasDetailsQuery({ projectId: undefined, id: 'c-1' }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('GETs elitea_core/canvas/prompt_lib/{projectId}/{id} and normalises the wire response', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/canvas/prompt_lib/7/c-1`, () =>
        HttpResponse.json({ uuid: 'c-1', canvas_type: 'code', code_language: 'python', canvas_content: 'print(1)' }),
      ),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCanvasDetailsQuery({ projectId: 7, id: 'c-1' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ uuid: 'c-1', canvasType: 'code', codeLanguage: 'python', content: 'print(1)' });
  });
});

describe('useCreateCanvasMutation', () => {
  it('POSTs elitea_core/canvases/prompt_lib/{projectId} with the body fields (minus projectId)', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/elitea_core/canvases/prompt_lib/7`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ uuid: 'new-canvas', canvas_type: 'code' });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateCanvasMutation(), { wrapper });
    result.current.mutate({ projectId: 7, canvas_type: 'code', message_group_uuid: 'mg-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ canvas_type: 'code', message_group_uuid: 'mg-1' });
    expect(result.current.data).toEqual({ uuid: 'new-canvas', canvasType: 'code' });
  });
});

describe('useEditCanvasMutation', () => {
  it('PUTs elitea_core/canvas/prompt_lib/{projectId}/{canvasUUID}', async () => {
    server.use(
      http.put(`${BASE}/elitea_core/canvas/prompt_lib/7/c-1`, () => HttpResponse.json({ uuid: 'c-1', canvas_content: 'x' })),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useEditCanvasMutation(), { wrapper });
    result.current.mutate({ projectId: 7, canvasUUID: 'c-1', canvas_content: 'x' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ uuid: 'c-1', content: 'x' });
  });
});

describe('useSetAttachmentStorageMutation', () => {
  it('PUTs elitea_core/attachment_storage/prompt_lib/{projectId}/{conversationId} with {toolkit_id}', async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${BASE}/elitea_core/attachment_storage/prompt_lib/7/conv-1`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSetAttachmentStorageMutation(), { wrapper });
    result.current.mutate({ projectId: 7, conversationId: 'conv-1', toolkit_id: 42 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ toolkit_id: 42 });
  });
});

describe('useRemoveAttachmentsMutation', () => {
  it('DELETEs with repeated filename params from an attachment-object array plus keep_in_storage', async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.delete(`${BASE}/elitea_core/attachments/prompt_lib/7/conv-1`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveAttachmentsMutation(), { wrapper });
    result.current.mutate({
      projectId: 7,
      conversationId: 'conv-1',
      attachments: [{ name: 'a.txt' }, { name: 'b.txt' }],
      keep_in_storage: true,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl?.searchParams.getAll('filename')).toEqual(['a.txt', 'b.txt']);
    expect(capturedUrl?.searchParams.get('keep_in_storage')).toBe('1');
  });

  it('accepts a single filename string and defaults keep_in_storage to 0', async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.delete(`${BASE}/elitea_core/attachments/prompt_lib/7/conv-1`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRemoveAttachmentsMutation(), { wrapper });
    result.current.mutate({ projectId: 7, conversationId: 'conv-1', attachments: 'solo.txt' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl?.searchParams.getAll('filename')).toEqual(['solo.txt']);
    expect(capturedUrl?.searchParams.get('keep_in_storage')).toBe('0');
  });
});

describe('useUploadAttachmentsMutation', () => {
  it('sends one uploadSmallFile call per attachment, sequentially, to the shared attachment-upload endpoint', async () => {
    const { wrapper } = createWrapper();
    server.use(smallFileOk());
    const { result } = renderHook(() => useUploadAttachmentsMutation(), { wrapper });
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
    result.current.mutate({ baseUrl: ORIGIN, projectId: '7', conversationId: 'conv-1', attachments: files });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.every((outcome) => outcome.ok)).toBe(true);
  });

  it('surfaces a per-file http failure as a non-ok UploadResult rather than throwing', async () => {
    const { wrapper } = createWrapper();
    server.use(uploadServerError());
    const { result } = renderHook(() => useUploadAttachmentsMutation(), { wrapper });
    result.current.mutate({ baseUrl: ORIGIN, projectId: '7', conversationId: 'conv-1', attachments: [new File(['a'], 'a.txt')] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toEqual({ ok: false, error: { kind: 'http', status: 500 } });
  });
});
