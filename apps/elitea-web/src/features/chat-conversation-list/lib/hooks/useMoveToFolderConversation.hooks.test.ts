import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useMoveToFolderConversation } from './useMoveToFolderConversation.hooks';
import type { ConversationWithTargetFolder } from './useMoveToFolderConversation.hooks';
import type { FolderListItem } from './conversationListState.types';

const BASE = '/api/v2';

function mkConv(overrides: Partial<ConversationWithTargetFolder> & { readonly id: string }): ConversationWithTargetFolder {
  return { name: overrides.id, isPrivate: true, ...overrides };
}

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string; readonly conversations: readonly ConversationWithTargetFolder[] }): FolderListItem {
  return { name: overrides.id, ...overrides };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useMoveToFolderConversation', () => {
  it('onMoveToFolderConversation happy path: PUTs folder_id and moves the conversation into the target folder locally', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/c1`, () => HttpResponse.json({ id: 'c1', name: 'c1' })));

    const setFolders = vi.fn();
    const setActiveFolder = vi.fn();
    const setConversations = vi.fn();
    const toastSuccess = vi.fn();
    const conv = mkConv({ id: 'c1' });
    const targetFolder = mkFolder({ id: 'fA', conversations: [] });

    const { result } = renderHook(() =>
      useMoveToFolderConversation({ projectId: '7', setFolders, setActiveFolder, setConversations, toastError: vi.fn(), toastSuccess }),
    );

    const outcome = await result.current.onMoveToFolderConversation(conv, targetFolder);

    expect(outcome).toEqual({ success: true, conversation: conv });
    expect(setConversations).toHaveBeenCalled();
    expect(setFolders).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Chat moved to "fA" folder successfully');
  });

  it('error path: a failed PUT toasts the built error message and resolves {success: false}', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/c1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setFolders = vi.fn();
    const setConversations = vi.fn();
    const toastError = vi.fn();
    const conv = mkConv({ id: 'c1' });
    const targetFolder = mkFolder({ id: 'fA', conversations: [] });

    const { result } = renderHook(() =>
      useMoveToFolderConversation({ projectId: '7', setFolders, setActiveFolder: vi.fn(), setConversations, toastError }),
    );

    const outcome = await result.current.onMoveToFolderConversation(conv, targetFolder);

    expect(outcome.success).toBe(false);
    expect(setFolders).not.toHaveBeenCalled();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('boom'));
  });

  it('distinctive rule: hasPlaybackConversations blocks the move with a toast and no network call', async () => {
    let hit = false;
    server.use(
      http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/c1`, () => {
        hit = true;
        return HttpResponse.json({});
      }),
    );

    const toastError = vi.fn();
    const conv = mkConv({ id: 'c1' });
    const playbackSnapshot = mkConv({ id: 'c1', isPlayback: true });
    const targetFolder = mkFolder({ id: 'fA', conversations: [] });

    const { result } = renderHook(() =>
      useMoveToFolderConversation({
        projectId: '7',
        setFolders: vi.fn(),
        setActiveFolder: vi.fn(),
        setConversations: vi.fn(),
        toastError,
        conversations: [playbackSnapshot],
      }),
    );

    const outcome = await result.current.onMoveToFolderConversation(conv, targetFolder);

    expect(outcome).toEqual({ success: false, error: 'Cannot move conversation with active playback conversations' });
    expect(hit).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      'Cannot move this conversation while playback conversations exist. Please delete all playback conversations first.',
    );
  });

  it('onMoveToNewFolderConversation: creates a local draft folder (isNew) after the 10ms delay and activates it', async () => {
    const setFolders = vi.fn();
    const setActiveFolder = vi.fn();
    const setConversations = vi.fn();
    const conv = mkConv({ id: 'c1' });

    const { result } = renderHook(() =>
      useMoveToFolderConversation({ projectId: '7', setFolders, setActiveFolder, setConversations, toastError: vi.fn() }),
    );

    await result.current.onMoveToNewFolderConversation(conv);

    expect(setConversations).toHaveBeenCalled();
    const foldersUpdater = setFolders.mock.calls[0]?.[0] as (prev: readonly FolderListItem[]) => readonly FolderListItem[];
    const nextFolders = foldersUpdater([]);
    expect(nextFolders).toHaveLength(1);
    expect(nextFolders[0]).toMatchObject({ id: 'c1_to_new_folder', name: 'New folder', isNew: true, targetConversationId: 'c1' });
    expect(setActiveFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1_to_new_folder', isNew: true }));
  });

  it('moveTargetConversationToNewFolder: POSTs the real folder, then moves the target conversation into it', async () => {
    server.use(
      http.post(`${BASE}/elitea_core/folder/prompt_lib/7`, () => HttpResponse.json({ id: 'f-real', name: 'New folder' })),
      http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/c1`, () => HttpResponse.json({ id: 'c1' })),
    );

    const setFolders = vi.fn();
    const setActiveFolder = vi.fn();
    const setConversations = vi.fn();
    const conv = mkConv({ id: 'c1' });
    const draft = {
      id: 'c1_to_new_folder',
      name: 'New folder',
      conversations: [],
      isNew: true as const,
      targetConversationId: 'c1',
      targetConversation: conv,
    };

    const { result } = renderHook(() =>
      useMoveToFolderConversation({ projectId: '7', setFolders, setActiveFolder, setConversations, toastError: vi.fn() }),
    );

    const outcome = await result.current.moveTargetConversationToNewFolder(draft);

    expect(outcome?.success).toBe(true);
    expect(setActiveFolder).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'f-real' }));
  });

  it('cancelMovingTargetConversationToNewFolder clears the pending targetFolderId scratch field', () => {
    const setConversations = vi.fn();
    const conv = mkConv({ id: 'c1' });
    const draft = {
      id: 'c1_to_new_folder',
      name: 'New folder',
      conversations: [],
      isNew: true as const,
      targetConversationId: 'c1',
      targetConversation: conv,
    };

    const { result } = renderHook(() =>
      useMoveToFolderConversation({ projectId: '7', setFolders: vi.fn(), setActiveFolder: vi.fn(), setConversations, toastError: vi.fn() }),
    );

    result.current.cancelMovingTargetConversationToNewFolder(draft);

    const updater = setConversations.mock.calls[0]?.[0] as (prev: readonly ConversationWithTargetFolder[]) => readonly ConversationWithTargetFolder[];
    expect(updater([{ ...conv, targetFolderId: 'c1_to_new_folder' }])[0]?.targetFolderId).toBeNull();
  });
});
