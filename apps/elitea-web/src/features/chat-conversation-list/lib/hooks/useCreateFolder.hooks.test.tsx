import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPermissionListQueryKey } from '@/shared/api/generated/auth/auth';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useCreateFolder } from './useCreateFolder.hooks';
import type { FolderListItem } from './conversationListState.types';

const BASE = '/api/v2';
const PROJECT_ID = '7';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
}

/**
 * Primes the permission-list query's cache directly, synchronously, before
 * the first render — `useHasPermission` reads this via TanStack Query, and
 * without priming, the hook's very first render sees `hasPermission: false`
 * until the (mocked, but still async) GET resolves. `waitFor(() =>
 * expect(result.current).toBeDefined())` does NOT wait for that (`result.
 * current` is always truthy), so any test that calls the guarded action
 * immediately after `renderHook` races the permission fetch — this priming
 * makes the permission available on the FIRST render, deterministically.
 */
function createWrapper(permissionNames: readonly string[]): { readonly wrapper: ({ children }: { children: ReactNode }) => ReactNode; readonly client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(getPermissionListQueryKey(PROJECT_ID), {
    data: permissionNames.map((name) => ({ name, enabled: true })),
    status: 200,
    headers: new Headers(),
  });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, client };
}

/**
 * Applies whatever `setFolders` was handed — a functional updater or (pre-fix)
 * a ready-made array — to `prev`, so an assertion states the LIST THE SIDEBAR
 * ENDS UP WITH rather than the shape of the call. Both stale-closure repros
 * below depend on that distinction being invisible to the assertion.
 */
function applyFolderWrite(write: unknown, prev: readonly FolderListItem[]): readonly FolderListItem[] {
  return typeof write === 'function' ? (write as (p: readonly FolderListItem[]) => readonly FolderListItem[])(prev) : (write as readonly FolderListItem[]);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useCreateFolder', () => {
  it('happy path: optimistically sets the draft, then replaces it with the server folder and prepends it to folders', async () => {
    server.use(http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => HttpResponse.json({ id: 'f1', name: 'New folder' })));

    const setActiveFolder = vi.fn();
    const setFolders = vi.fn();
    const onCreated = vi.fn();
    const draft = mkFolder({ id: 'draft-1', isNew: true });
    const existing = mkFolder({ id: 'existing' });

    const { wrapper } = createWrapper(['models.chat.folders.create']);
    const { result } = renderHook(
      () => useCreateFolder({ projectId: '7', folders: [existing], setActiveFolder, setFolders, toastError: vi.fn() }),
      { wrapper },
    );

    await result.current.onCreateFolder(draft, onCreated);

    expect(setActiveFolder).toHaveBeenNthCalledWith(1, draft);
    expect(setActiveFolder).toHaveBeenNthCalledWith(2, { id: 'f1', name: 'New folder', conversations: [] });
    expect(applyFolderWrite(setFolders.mock.calls.at(-1)?.[0], [draft, existing])).toEqual([{ id: 'f1', name: 'New folder', conversations: [] }, existing]);
    expect(onCreated).toHaveBeenCalledWith({ id: 'f1', name: 'New folder', conversations: [] });
  });

  it('error path: toasts the built error message and resets activeFolder to undefined', async () => {
    server.use(http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setActiveFolder = vi.fn();
    const setFolders = vi.fn();
    const toastError = vi.fn();
    const onCreated = vi.fn();
    const draft = mkFolder({ id: 'draft-1', isNew: true });

    const { wrapper } = createWrapper(['models.chat.folders.create']);
    const { result } = renderHook(() => useCreateFolder({ projectId: '7', folders: [], setActiveFolder, setFolders, toastError }), {
      wrapper,
    });

    await result.current.onCreateFolder(draft, onCreated);

    expect(setActiveFolder).toHaveBeenLastCalledWith(undefined);
    expect(onCreated).toHaveBeenCalledWith();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('distinctive rule: without folders.create permission, never calls the network, resets immediately, and toasts (found missing by adversarial verify)', async () => {
    let postHit = false;
    server.use(
      http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => {
        postHit = true;
        return HttpResponse.json({ id: 'should-not-happen' });
      }),
    );

    const setActiveFolder = vi.fn();
    const setFolders = vi.fn();
    const onCreated = vi.fn();
    const toastError = vi.fn();
    const draft = mkFolder({ id: 'draft-1', isNew: true });

    const { wrapper } = createWrapper([]);
    const { result } = renderHook(() => useCreateFolder({ projectId: '7', folders: [], setActiveFolder, setFolders, toastError }), {
      wrapper,
    });

    await result.current.onCreateFolder(draft, onCreated);

    expect(postHit).toBe(false);
    expect(setActiveFolder).toHaveBeenLastCalledWith(undefined);
    expect(onCreated).toHaveBeenCalledWith();
    expect(toastError).toHaveBeenCalledWith('You do not have permission to create folders');
  });

  it('does not toast when projectId itself is undefined (not-ready, distinct from a real permission denial)', async () => {
    const setActiveFolder = vi.fn();
    const setFolders = vi.fn();
    const toastError = vi.fn();
    const draft = mkFolder({ id: 'draft-1', isNew: true });

    const { wrapper } = createWrapper([]);
    const { result } = renderHook(() => useCreateFolder({ projectId: undefined, folders: [], setActiveFolder, setFolders, toastError }), {
      wrapper,
    });

    await result.current.onCreateFolder(draft);

    expect(toastError).not.toHaveBeenCalled();
  });

  /**
   * DEFECT (render-time snapshot, written a round trip later): the post-create
   * write REPLACED the folder list with `[created, ...folders]`, where `folders`
   * was this hook's render-time parameter — but the write runs after `await
   * folderApi.create`. `useQueryFoldersList` populates that same container
   * asynchronously, so its first page landing during the POST (the common case
   * on a cold sidebar: the folder list request and a fast create overlap) was
   * discarded wholesale — the folders were on screen, then gone, with no error.
   *
   * Repro shape from `processes/chat/model/useConversationSidebar.test.tsx`:
   * capture the handler while the list is empty, THEN let the list arrive, THEN
   * invoke that exact reference.
   */
  it('keeps folders that arrived during the POST, from a handler captured while the list was empty (stale-closure repro)', async () => {
    server.use(http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => HttpResponse.json({ id: 'f1', name: 'New folder' })));

    const setFolders = vi.fn();
    const draft = mkFolder({ id: 'draft-1', isNew: true });
    const arrived = mkFolder({ id: 'from-listing' });

    const { wrapper } = createWrapper(['models.chat.folders.create']);
    const { result, rerender } = renderHook(
      ({ folders }: { folders: readonly FolderListItem[] }) =>
        useCreateFolder({ projectId: '7', folders, setActiveFolder: vi.fn(), setFolders, toastError: vi.fn() }),
      { wrapper, initialProps: { folders: [] as readonly FolderListItem[] } },
    );

    // Captured while the sidebar had nothing in it.
    const staleCreate = result.current.onCreateFolder;

    // The listing lands AFTER the handler was captured.
    rerender({ folders: [arrived] });

    await staleCreate(draft);

    // A pre-fix build hands `setFolders` the array `[created]`, so `arrived` is
    // gone; the live write amends whatever the container holds at commit time.
    expect(applyFolderWrite(setFolders.mock.calls.at(-1)?.[0], [draft, arrived]).map((folder) => folder.id)).toEqual(['f1', 'from-listing']);
  });

  /**
   * Regression (found by adversarial verify): `folderApi.create` is the
   * plain fetcher — nothing invalidated the cached `foldersList` query on a
   * successful create, so e.g. `useQueryFoldersList`'s `totalFolderCount`
   * (read straight off the TanStack cache) stayed stale for up to the
   * default 30s `staleTime`.
   */
  it('invalidates the cached folder list on a successful create', async () => {
    server.use(http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => HttpResponse.json({ id: 'f1', name: 'New folder' })));

    const { wrapper, client } = createWrapper(['models.chat.folders.create']);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useCreateFolder({ projectId: '7', folders: [], setActiveFolder: vi.fn(), setFolders: vi.fn(), toastError: vi.fn() }),
      { wrapper },
    );

    await result.current.onCreateFolder(mkFolder({ id: 'draft-1', isNew: true }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folder', 'list'] });
  });
});
