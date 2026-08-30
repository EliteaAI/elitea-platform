import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { usePinConversation } from './usePinConversation.hooks';
import type { DateGroupListItem, FolderListItem } from './conversationListState.types';

const BASE = '/api/v2';

function mkConv(overrides: Partial<Conversation> & { readonly id: string }): Conversation {
  return { name: overrides.id, isPrivate: true, ...overrides };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('usePinConversation', () => {
  it('happy path (ungrouped): pinning POSTs to /social/pin, prepends to pinned, and removes from its date group', async () => {
    server.use(http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ ok: true }, { status: 200 })));

    const setPinnedConversations = vi.fn();
    const setDateGroups = vi.fn();
    const setFolders = vi.fn();
    const conv = mkConv({ id: '1' });

    const { result } = renderHook(
      () =>
        usePinConversation({
          projectId: '7',
          activeConversation: undefined,
          setActiveConversation: vi.fn(),
          setPinnedConversations,
          setDateGroups,
          setFolders,
        }),
      { wrapper },
    );

    await result.current.onPinConversation(conv, true);

    expect(setPinnedConversations).toHaveBeenCalledTimes(1);
    const pinnedUpdater = setPinnedConversations.mock.calls[0]?.[0] as (prev: readonly Conversation[]) => readonly Conversation[];
    expect(pinnedUpdater([])).toEqual([{ ...conv, isPinned: true }]);

    const groupsUpdater = setDateGroups.mock.calls[0]?.[0] as (prev: readonly DateGroupListItem[]) => readonly DateGroupListItem[];
    const groups: DateGroupListItem[] = [{ name: 'today', conversations: [conv], total: 1 }];
    expect(groupsUpdater(groups)[0]).toMatchObject({ conversations: [], total: 0 });
    expect(setFolders).not.toHaveBeenCalled();
  });

  it('happy path (in a folder): pinning removes the conversation from its folder instead of any date group', async () => {
    server.use(http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ ok: true }, { status: 200 })));

    const setFolders = vi.fn();
    const conv = mkConv({ id: '1', folderId: 'fA' });

    const { result } = renderHook(
      () =>
        usePinConversation({
          projectId: '7',
          activeConversation: undefined,
          setActiveConversation: vi.fn(),
          setPinnedConversations: vi.fn(),
          setDateGroups: vi.fn(),
          setFolders,
        }),
      { wrapper },
    );

    await result.current.onPinConversation(conv, true);

    const foldersUpdater = setFolders.mock.calls[0]?.[0] as (prev: readonly FolderListItem[]) => readonly FolderListItem[];
    const folders: FolderListItem[] = [{ id: 'fA', name: 'A', conversations: [conv], total: 1 }];
    expect(foldersUpdater(folders)[0]).toMatchObject({ conversations: [], total: 0 });
  });

  it('rollback path (pin fails): reverts the optimistic pin, restores to date groups, and toasts', async () => {
    server.use(http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setPinnedConversations = vi.fn();
    const setDateGroups = vi.fn();
    const toastError = vi.fn();
    const conv = mkConv({ id: '1' });

    const { result } = renderHook(
      () =>
        usePinConversation({
          projectId: '7',
          activeConversation: undefined,
          setActiveConversation: vi.fn(),
          setPinnedConversations,
          setDateGroups,
          setFolders: vi.fn(),
          toastError,
        }),
      { wrapper },
    );

    await result.current.onPinConversation(conv, true);

    // Optimistic apply, then rollback: setPinnedConversations called twice (prepend, then filter back out).
    expect(setPinnedConversations).toHaveBeenCalledTimes(2);
    const rollbackUpdater = setPinnedConversations.mock.calls[1]?.[0] as (prev: readonly Conversation[]) => readonly Conversation[];
    expect(rollbackUpdater([{ ...conv, isPinned: true }])).toEqual([]);

    // setDateGroups called twice too: remove (optimistic), then restore (rollback).
    expect(setDateGroups).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to pin conversation'));
  });

  it('rollback path (unpin fails): re-adds to pinned and toasts the unpin-specific message', async () => {
    server.use(http.delete(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setPinnedConversations = vi.fn();
    const toastError = vi.fn();
    const conv = mkConv({ id: '1', isPinned: true });

    const { result } = renderHook(
      () =>
        usePinConversation({
          projectId: '7',
          activeConversation: undefined,
          setActiveConversation: vi.fn(),
          setPinnedConversations,
          setDateGroups: vi.fn(),
          setFolders: vi.fn(),
          toastError,
        }),
      { wrapper },
    );

    await result.current.onPinConversation(conv, false);

    expect(setPinnedConversations).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to unpin conversation'));
  });

  it('distinctive rule: the active conversation is kept in sync (and reverted on rollback)', async () => {
    server.use(http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    const setActiveConversation = vi.fn();
    const active = mkConv({ id: '1' });

    const { result } = renderHook(
      () =>
        usePinConversation({
          projectId: '7',
          activeConversation: active,
          setActiveConversation,
          setPinnedConversations: vi.fn(),
          setDateGroups: vi.fn(),
          setFolders: vi.fn(),
          toastError: vi.fn(),
        }),
      { wrapper },
    );

    await result.current.onPinConversation(active, true);

    expect(setActiveConversation).toHaveBeenCalledTimes(2);
    const optimisticUpdater = setActiveConversation.mock.calls[0]?.[0] as (prev: Conversation | undefined) => Conversation | undefined;
    expect(optimisticUpdater(active)?.isPinned).toBe(true);
    const revertUpdater = setActiveConversation.mock.calls[1]?.[0] as (prev: Conversation | undefined) => Conversation | undefined;
    expect(revertUpdater(active)?.isPinned).toBe(false);
  });

  /**
   * DEFECT (stale row-handler): `onPinConversation` reaches a memoised
   * `ConversationItem` through `useRenderConversationItem`'s `useCallback([])`
   * render prop, so a row rendered BEFORE its conversation was selected keeps
   * the closure that render built. Deciding "is this the open conversation?"
   * from that closure's captured `activeConversation` answered `undefined`, and
   * the open transcript's own `isPinned` was never synced — the row moved into
   * the pinned section while the open conversation still rendered as unpinned.
   *
   * Repro shape borrowed from `processes/chat/model/useConversationSidebar.
   * test.tsx`: grab the handler while nothing is selected, THEN select, THEN
   * invoke that exact reference.
   */
  it('syncs the conversation open at CALL time from a handler captured BEFORE it was selected (stale-closure repro)', async () => {
    server.use(http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, () => HttpResponse.json({ ok: true }, { status: 200 })));

    const setActiveConversation = vi.fn();
    const conv = mkConv({ id: '1' });

    const { result, rerender } = renderHook(
      ({ activeConversation }: { activeConversation: Conversation | undefined }) =>
        usePinConversation({
          projectId: '7',
          activeConversation,
          setActiveConversation,
          setPinnedConversations: vi.fn(),
          setDateGroups: vi.fn(),
          setFolders: vi.fn(),
        }),
      { wrapper, initialProps: { activeConversation: undefined as Conversation | undefined } },
    );

    // The reference a row rendered before any selection carries.
    const stalePin = result.current.onPinConversation;

    // Selected AFTER the handler was captured.
    rerender({ activeConversation: conv });

    await stalePin(conv, true);

    // A pre-fix build never calls this at all: its guard compares `undefined`.
    expect(setActiveConversation).toHaveBeenCalledTimes(1);
    const updater = setActiveConversation.mock.calls[0]?.[0] as (prev: Conversation | undefined) => Conversation | undefined;
    expect(updater(conv)?.isPinned).toBe(true);
  });

  /**
   * DEFECT (same value, read a whole round trip later): the rollback branch runs
   * AFTER `await togglePin`. Reading the conversation that was open when the
   * request STARTED made a failed pin write its `isPinned` onto whichever
   * conversation the user had switched to in the meantime.
   */
  it('rolls back against the conversation open when the request FAILED, not the one open when it started', async () => {
    let release: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/social/pin/prompt_lib/7/conversation/1`, async () => {
        await inFlight;
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );

    const setActiveConversation = vi.fn();
    const opened = mkConv({ id: '1' });
    const switchedTo = mkConv({ id: '2' });

    const { result, rerender } = renderHook(
      ({ activeConversation }: { activeConversation: Conversation | undefined }) =>
        usePinConversation({
          projectId: '7',
          activeConversation,
          setActiveConversation,
          setPinnedConversations: vi.fn(),
          setDateGroups: vi.fn(),
          setFolders: vi.fn(),
          toastError: vi.fn(),
        }),
      { wrapper, initialProps: { activeConversation: opened } },
    );

    const pending = result.current.onPinConversation(opened, true);
    // The user opens a different conversation while the POST is in flight.
    rerender({ activeConversation: switchedTo });
    release();
    await pending;

    // Exactly one write — the optimistic one, while '1' really was open. A
    // pre-fix build writes a second time, patching '2' with '1' rollback.
    expect(setActiveConversation).toHaveBeenCalledTimes(1);
  });
});
