import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadArtifactsAsZip } from '@/shared/api/artifacts';
import * as sharedArtifacts from '@/shared/api/artifacts';
import * as runtimeConfig from '@/shared/config';
import { triggerBlobDownload } from '@/shared/lib/download';
import * as download from '@/shared/lib/download';

import { useZipDownload } from './useZipDownload';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sharedArtifacts, 'downloadArtifactsAsZip');
  vi.spyOn(runtimeConfig, 'getConfig').mockReturnValue({
    status: 'ok',
    config: {
      vite_server_url: '/api/v2',
      vite_base_uri: '/',
      vite_public_project_id: 'public',
      allow_project_own_llms: false,
    },
  });
  vi.spyOn(download, 'triggerBlobDownload').mockImplementation(() => undefined);
});

describe('useZipDownload', () => {
  it('reports progress and downloads a completed archive', async () => {
    vi.mocked(downloadArtifactsAsZip).mockImplementation((params) => {
      params.onProgress?.(1, 1, 'a.txt');
      return Promise.resolve({ status: 'ok', blob: new Blob(['zip']) });
    });
    const hook = renderHook(() => useZipDownload());
    await act(() => hook.result.current.start({
      projectId: 'p1',
      bucket: 'docs',
      filenames: ['a.txt'],
    }));
    expect(triggerBlobDownload).toHaveBeenCalledWith(expect.any(Blob), 'docs.zip');
    expect(hook.result.current.progress.open).toBe(false);
  });

  it('supports cancellation and surfaces failed files', async () => {
    let resolveDownload: ((value: { status: 'cancelled' }) => void) | undefined;
    vi.mocked(downloadArtifactsAsZip).mockReturnValue(new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    const hook = renderHook(() => useZipDownload());
    act(() => {
      void hook.result.current.start({
        projectId: 'p1',
        bucket: 'docs',
        filenames: ['a.txt'],
      });
    });
    await waitFor(() => expect(hook.result.current.progress.open).toBe(true));
    act(() => hook.result.current.cancel());
    resolveDownload?.({ status: 'cancelled' });
    await waitFor(() => expect(hook.result.current.progress.open).toBe(false));

    vi.mocked(downloadArtifactsAsZip).mockResolvedValue({
      status: 'error',
      filename: 'bad.txt',
      error: { kind: 'http', status: 500, url: '/bad', body: null },
    });
    await act(() => hook.result.current.start({
      projectId: 'p1',
      bucket: 'docs',
      filenames: ['bad.txt'],
    }));
    expect(hook.result.current.progress.error).toContain('bad.txt');

    vi.mocked(downloadArtifactsAsZip).mockRejectedValueOnce(new Error('archive failure'));
    await act(() => hook.result.current.start({
      projectId: 'p1',
      bucket: 'docs',
      filenames: ['throws.txt'],
    }));
    expect(hook.result.current.progress.error).toContain('prepare the ZIP');
  });
});
