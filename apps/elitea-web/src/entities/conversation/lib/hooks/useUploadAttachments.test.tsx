import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { smallFileOk, uploadServerError } from '@/test/msw/handlers/upload';

import { useUploadAttachments } from './useUploadAttachments';

const BASE_URL = window.location.origin;

function makeFile(name: string, content = 'hello'): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('useUploadAttachments', () => {
  it('is a no-op resolving success with no attachments', async () => {
    const { result } = renderHook(() => useUploadAttachments());
    let outcome: Awaited<ReturnType<typeof result.current.uploadAttachments>> | undefined;
    await act(async () => {
      outcome = await result.current.uploadAttachments({ baseUrl: BASE_URL, projectId: 'p1', conversationId: 'c1', attachments: [] });
    });
    expect(outcome).toEqual({ success: true, uploaded: [] });
  });

  it('uploads a small file and reports success with the sanitized filename', async () => {
    server.use(smallFileOk());
    const { result } = renderHook(() => useUploadAttachments());
    const file = makeFile('doc.txt');

    let outcome: Awaited<ReturnType<typeof result.current.uploadAttachments>> | undefined;
    await act(async () => {
      outcome = await result.current.uploadAttachments({ baseUrl: BASE_URL, projectId: 'p1', conversationId: 'c1', attachments: [file] });
    });

    expect(outcome?.success).toBe(true);
    if (outcome?.success) {
      expect(outcome.uploaded).toHaveLength(1);
      expect(outcome.uploaded[0]?.file).toBe(file);
      // fixture has no `filepath` field — falls back to the original file name (see sanitizedNameFrom).
      expect(outcome.uploaded[0]?.sanitizedName).toBe('doc.txt');
    }
  });

  it('resets isUploading/uploadingAttachments after completion', async () => {
    server.use(smallFileOk());
    const { result } = renderHook(() => useUploadAttachments());
    await act(async () => {
      await result.current.uploadAttachments({ baseUrl: BASE_URL, projectId: 'p1', conversationId: 'c1', attachments: [makeFile('a.txt')] });
    });
    await waitFor(() => expect(result.current.isUploading).toBe(false));
    expect(result.current.uploadingAttachments).toEqual([]);
  });

  it('reports failure and stops at the first failing file', async () => {
    server.use(uploadServerError());
    const { result } = renderHook(() => useUploadAttachments());
    const file = makeFile('bad.txt');

    let outcome: Awaited<ReturnType<typeof result.current.uploadAttachments>> | undefined;
    await act(async () => {
      outcome = await result.current.uploadAttachments({ baseUrl: BASE_URL, projectId: 'p1', conversationId: 'c1', attachments: [file] });
    });

    expect(outcome?.success).toBe(false);
    if (outcome && !outcome.success) {
      expect(outcome.failedFile).toBe(file);
      expect(outcome.uploaded).toEqual([]);
    }
  });
});
