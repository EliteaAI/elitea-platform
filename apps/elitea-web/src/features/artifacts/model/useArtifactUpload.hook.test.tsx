import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putArtifactToS3 } from '@/shared/api/artifacts';
import * as sharedArtifacts from '@/shared/api/artifacts';
import * as chatApi from '@/shared/api/generated/chat/chat';
import * as runtimeConfig from '@/shared/config';
import type { Artifact } from '@/entities/artifact';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { useArtifactUpload } from './useArtifactUpload';

const contents: Artifact[] = [
  { key: 'existing.txt', size: 1, lastModified: '2026-01-01T00:00:00Z', bucket: 'docs' },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sharedArtifacts, 'putArtifactToS3');
  vi.spyOn(chatApi, 'useGetChatConfig').mockReturnValue({
    data: { data: { limits: { DEFAULT_MAX_FILE_SIZE: 100 } } },
  } as never);
  vi.spyOn(runtimeConfig, 'getConfig').mockReturnValue({
    status: 'ok',
    config: {
      vite_server_url: '/api/v2',
      vite_base_uri: '/',
      vite_public_project_id: 'public',
      allow_project_own_llms: false,
    },
  });
  vi.mocked(putArtifactToS3).mockResolvedValue({
    ok: true,
    data: undefined,
    status: 200,
    headers: new Headers(),
  });
});

function renderUpload(contentsOverride: readonly Artifact[] = contents) {
  const onUploaded = vi.fn().mockResolvedValue(undefined);
  const hook = renderHookWithProviders(() => useArtifactUpload({
    projectId: 'p1',
    bucket: 'docs',
    contents: contentsOverride,
    currentPrefix: '',
    onUploaded,
  }));
  return { ...hook, onUploaded };
}

describe('useArtifactUpload', () => {
  it('stages a safe upload and refreshes after completion', async () => {
    const hook = renderUpload([]);
    const file = new File(['new'], 'new.txt', { type: 'text/plain' });
    act(() => hook.result.current.stageFiles([file]));
    expect(hook.result.current.pathDialogOpen).toBe(true);
    act(() => hook.result.current.confirmPath('folder'));
    await waitFor(() => expect(putArtifactToS3).toHaveBeenCalledWith(expect.objectContaining({
      fileKey: 'folder/new.txt',
      projectId: 'p1',
    })));
    await waitFor(() => expect(hook.onUploaded).toHaveBeenCalled());
  });

  it('offers replace, skip, and keep-both duplicate strategies', async () => {
    const duplicate = new File(['x'], 'existing.txt');
    const hook = renderUpload();
    act(() => hook.result.current.stageFiles([duplicate]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.result.current.duplicateDialogOpen).toBe(true));
    act(() => hook.result.current.keepBoth());
    await waitFor(() => expect(putArtifactToS3).toHaveBeenCalledWith(expect.objectContaining({
      fileKey: 'existing - Copy.txt',
    })));

    act(() => hook.result.current.stageFiles([duplicate]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.result.current.duplicateDialogOpen).toBe(true));
    act(() => hook.result.current.replaceDuplicates());
    await waitFor(() => expect(putArtifactToS3).toHaveBeenCalledWith(expect.objectContaining({
      fileKey: 'existing.txt',
    })));

    act(() => hook.result.current.stageFiles([duplicate]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.result.current.duplicateDialogOpen).toBe(true));
    act(() => hook.result.current.skipDuplicates());
    await waitFor(() => expect(hook.onUploaded).toHaveBeenCalledTimes(3));
  });

  it('reports validation and transport failures', async () => {
    const hook = renderUpload([]);
    act(() => hook.result.current.stageFiles([new File(['bad'], 'bad#.txt')]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.result.current.error).toContain('bad#.txt'));
    vi.mocked(putArtifactToS3).mockResolvedValue({
      ok: false,
      error: { kind: 'http', status: 500, url: '/upload', body: null },
    });
    act(() => hook.result.current.stageFiles([new File(['ok'], 'ok.txt')]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.result.current.error).toContain('Failed to upload'));
  });

  it('uploads a batch best-effort — one failing file does not stop the others from completing', async () => {
    const hook = renderUpload([]);
    vi.mocked(putArtifactToS3).mockImplementation(({ fileKey }) =>
      Promise.resolve(
        fileKey.endsWith('bad.txt')
          ? { ok: false, error: { kind: 'http', status: 500, url: '/upload', body: null } }
          : { ok: true, data: undefined, status: 200, headers: new Headers() },
      ),
    );
    act(() => hook.result.current.stageFiles([new File(['x'], 'good.txt'), new File(['y'], 'bad.txt')]));
    act(() => hook.result.current.confirmPath(''));
    await waitFor(() => expect(hook.onUploaded).toHaveBeenCalledTimes(1));
    expect(hook.result.current.error).toContain('bad.txt');
    expect(hook.result.current.error).not.toContain('good.txt');
    expect(putArtifactToS3).toHaveBeenCalledWith(expect.objectContaining({ fileKey: 'good.txt' }));
    expect(putArtifactToS3).toHaveBeenCalledWith(expect.objectContaining({ fileKey: 'bad.txt' }));
  });
});
