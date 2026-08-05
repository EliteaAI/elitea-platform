import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Participant } from '@/entities/participant';

import { renderWithProviders } from '../../__tests__/testUtils';

import type { ChatApplicationVersionDetails, ChatConversation } from './applicationChat.types';
import type { UseApplicationChatConversationParams } from './useApplicationChatConversation.hooks';
import { useApplicationChatConversation } from './useApplicationChatConversation.hooks';

/**
 * Regression test for a CRITICAL infinite-render-loop bug: `applicationParticipant`
 * (this file's own `useMemo`) used to depend on `applicationVersionDetails` by object
 * identity. A caller that hands this hook a NEW-but-equal `applicationVersionDetails`
 * object on every render (e.g. a Formik-backed parent spreading `values.version_details`
 * into a fresh object each render — the exact shape `Harness` below reproduces) made the
 * memo recompute every render, which made `useSyncParticipantEffect` treat the participant
 * as "changed" and call `setActiveConversation` every render, which re-rendered the
 * component, which built a new `applicationVersionDetails` again — forever. Independently
 * reproduced live: React's nested-update guard eventually throws "Maximum update depth
 * exceeded" (at 302 renders in the live repro). This test fails the same way if the
 * `useMemo`/effect dependency stabilization in `useApplicationChatConversation.hooks.ts`
 * is reverted to depending on `applicationVersionDetails` directly.
 */
describe('useApplicationChatConversation — infinite render loop regression', () => {
  it('does not loop when applicationVersionDetails is a new-but-equal object every render', async () => {
    let renderCount = 0;

    function Harness(): null {
      renderCount += 1;

      // A brand-new object with EQUAL content every render — exactly what an unmemoized
      // parent (e.g. a form library spreading its values) would hand this hook.
      const applicationVersionDetails: ChatApplicationVersionDetails = {
        id: 'version-1',
        welcome_message: 'Hi there',
        variables: [{ name: 'x', value: '1' }],
        agent_type: 'chat',
        meta: { icon_meta: { url: 'icon.png' } },
      };

      useApplicationChatConversation({
        applicationId: 'app-1',
        applicationName: 'Test App',
        applicationVersionDetails,
        projectId: 'project-1',
        source: 'agent',
        restoredConversationID: null,
        restoredConversationData: undefined,
        isLoadingRestoredConversation: false,
        isErrorRestoredConversation: false,
        onRestoreConversationComplete: () => {},
      });

      return null;
    }

    act(() => {
      renderWithProviders(<Harness />);
    });

    // Flush any remaining microtasks/effects.
    await act(async () => {
      await Promise.resolve();
    });

    // A healthy mount settles after a small, bounded number of renders (participant
    // resolution, conversation creation, welcome-message injection). A regressed
    // version either throws "Maximum update depth exceeded" from inside the `act()`
    // calls above, or (if it hasn't hit that guard yet) leaves `renderCount` far past
    // any plausible bounded-settle count.
    expect(renderCount).toBeLessThan(20);
  });
});

function baseParams(overrides: Partial<UseApplicationChatConversationParams> = {}): UseApplicationChatConversationParams {
  return {
    applicationId: 'app-1',
    applicationName: 'My App',
    applicationVersionDetails: { id: 'v-1' },
    projectId: 'proj-1',
    source: 'agent',
    restoredConversationID: null,
    restoredConversationData: undefined,
    isLoadingRestoredConversation: false,
    isErrorRestoredConversation: false,
    onRestoreConversationComplete: vi.fn(),
    ...overrides,
  };
}

describe('useApplicationChatConversation — create-on-mount', () => {
  it('creates a fresh draft conversation once applicationParticipant resolves and there is nothing to restore', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams(),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({
      name: 'Chat with My App',
      is_private: true,
      source: 'agent',
      isNew: true,
      isApplicationChat: true,
    });
    expect(result.current.activeParticipant).toEqual(result.current.applicationParticipant);
    expect(result.current.isCreatingConversation).toBe(false);
  });

  it('falls back to an empty application name in the draft conversation name when applicationName is undefined', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationName: undefined }),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({ name: 'Chat with ' });
  });

  it('does not create a conversation when restoredConversationID is set', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 5 }),
    });

    // Give effects a tick to run; the conversation should remain null (nothing to restore was given).
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.activeConversation).toBeNull();
  });
});

describe('useApplicationChatConversation — restore-by-id', () => {
  it('adopts restoredConversationData once it resolves, and reports success via onInfo', async () => {
    const onInfo = vi.fn();
    const restoredConversationData: ChatConversation = {
      id: 42,
      uuid: 'uuid-42',
      chat_history: [{ id: 'm1', role: 'user' }],
      participants: [{ id: '9', entityName: 'application' }],
    };
    const onRestoreConversationComplete = vi.fn();
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({
        restoredConversationID: 42,
        restoredConversationData,
        onInfo,
        onRestoreConversationComplete,
      }),
    });

    await waitFor(() => expect(result.current.activeConversation?.id).toBe(42));
    expect(result.current.activeConversation).toMatchObject({ isApplicationChat: true });
    expect(result.current.activeParticipant).toEqual({ id: '9', entityName: 'application' });
    expect(result.current.chatHistoryRef.current).toEqual([{ id: 'm1', role: 'user' }]);
    expect(onInfo).toHaveBeenCalledWith('Chat restored successfully');
    expect(onRestoreConversationComplete).toHaveBeenCalled();
  });

  it('calls onError and skips adopting the conversation when it has no application participant', async () => {
    const onError = vi.fn();
    const restoredConversationData: ChatConversation = {
      id: 42,
      chat_history: [],
      participants: [{ id: '9', entityName: 'toolkit' }],
    };
    const onRestoreConversationComplete = vi.fn();
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 42, restoredConversationData, onError, onRestoreConversationComplete }),
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not find application participant in restored chat'));
    expect(result.current.activeConversation).toBeNull();
    expect(onRestoreConversationComplete).toHaveBeenCalled();
  });

  it('does nothing while isLoadingRestoredConversation is true, then restores once it flips to false', async () => {
    const restoredConversationData: ChatConversation = {
      id: 7,
      chat_history: [],
      participants: [{ id: '1', entityName: 'application' }],
    };
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 7, restoredConversationData, isLoadingRestoredConversation: true }),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.activeConversation).toBeNull();

    rerender(baseParams({ restoredConversationID: 7, restoredConversationData, isLoadingRestoredConversation: false }));
    await waitFor(() => expect(result.current.activeConversation?.id).toBe(7));
  });

  it('calls onError("Failed to restore conversation") when isErrorRestoredConversation is true and loading has finished', async () => {
    const onError = vi.fn();
    const onRestoreConversationComplete = vi.fn();
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 7, isErrorRestoredConversation: true, onError, onRestoreConversationComplete }),
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Failed to restore conversation'));
    expect(onRestoreConversationComplete).toHaveBeenCalled();
    expect(result.current.activeConversation).toBeNull();
  });

  it('does not report a restore error while still loading', async () => {
    const onError = vi.fn();
    renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 7, isErrorRestoredConversation: true, isLoadingRestoredConversation: true, onError }),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('useApplicationChatConversation — participant sync', () => {
  it('replaces the application participant entry in an existing conversation when applicationParticipant changes', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', meta: { icon_meta: { url: 'a.png' } } } }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    const firstParticipant = result.current.applicationParticipant;
    expect(result.current.activeConversation?.participants?.[0]).toEqual(firstParticipant);

    rerender(baseParams({ applicationVersionDetails: { id: 'v-2', meta: { icon_meta: { url: 'b.png' } } } }));

    await waitFor(() => expect(result.current.applicationParticipant?.entitySettings).toMatchObject({ versionId: 'v-2' }));
    await waitFor(() =>
      expect(result.current.activeConversation?.participants?.[0]).toEqual(result.current.applicationParticipant),
    );
    expect(result.current.activeConversation?.participants?.[0]).not.toEqual(firstParticipant);
  });

  it('leaves a non-application participant entry untouched while replacing only the application one', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1' } }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    const toolkitParticipant: Participant = { id: 'tk-1', entityName: 'toolkit' };

    // Inject a second, non-application participant via the exposed setter — a real path an
    // adapter-created conversation with multiple participants can produce.
    act(() => {
      result.current.setActiveConversation((prev) =>
        prev ? { ...prev, participants: [...(prev.participants ?? []), toolkitParticipant] } : prev,
      );
    });
    expect(result.current.activeConversation?.participants).toHaveLength(2);

    rerender(baseParams({ applicationVersionDetails: { id: 'v-2' } }));

    await waitFor(() => expect(result.current.applicationParticipant?.entitySettings).toMatchObject({ versionId: 'v-2' }));
    await waitFor(() => expect(result.current.activeConversation?.participants).toContainEqual(toolkitParticipant));
    expect(result.current.activeConversation?.participants).toContainEqual(result.current.applicationParticipant);
  });

  it('leaves the conversation untouched when it has no application-typed participant to sync', async () => {
    const restoredConversationData: ChatConversation = {
      id: 7,
      chat_history: [],
      participants: [{ id: '1', entityName: 'toolkit' }],
    };
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 7, restoredConversationData }),
    });

    // Restore fails (no application participant) so activeConversation stays null; the sync effect
    // has nothing to touch either way — this exercises its `!prev?.participants?.some(...)` guard's
    // `prev` being null.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.activeConversation).toBeNull();
  });
});

describe('useApplicationChatConversation — welcome message', () => {
  it('injects a welcome message at chat_history[0] once the conversation is created', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' } }),
    });

    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));
    expect(result.current.activeConversation?.chat_history[0]).toMatchObject({
      id: 'welcome_message_id',
      content: 'Hi there',
    });
  });

  it('replaces an existing welcome message rather than duplicating it when the message text changes', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' } }),
    });
    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));

    // Add a second message after the welcome one so we can prove the replace only touches index 0.
    act(() => {
      result.current.setChatHistory((prev) => [...prev, { id: 'm2', role: 'user', content: 'hello' }]);
    });
    expect(result.current.activeConversation?.chat_history).toHaveLength(2);

    rerender(baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Updated welcome' } }));

    await waitFor(() =>
      expect(result.current.activeConversation?.chat_history[0]).toMatchObject({ content: 'Updated welcome' }),
    );
    // The version id itself did NOT change, so the separate "reset on version id change" effect
    // does not fire — the second message survives the welcome-message replace.
    expect(result.current.activeConversation?.chat_history).toHaveLength(2);
  });

  it('removes a stale welcome message once welcome_message becomes undefined', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' } }),
    });
    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));

    rerender(baseParams({ applicationVersionDetails: { id: 'v-1' } }));

    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(0));
  });

  it('is a no-op when welcome_message is undefined and there is no existing welcome message to remove', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1' } }),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation?.chat_history).toEqual([]);
  });

  it('skips welcome-message injection for a restored conversation', async () => {
    const restoredConversationData: ChatConversation = {
      id: 7,
      chat_history: [{ id: 'm1', role: 'user' }],
      participants: [{ id: '1', entityName: 'application' }],
    };
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({
        applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' },
        restoredConversationID: 7,
        restoredConversationData,
      }),
    });

    await waitFor(() => expect(result.current.activeConversation?.id).toBe(7));
    // Only the restored message is present — no welcome message was spliced in.
    expect(result.current.activeConversation?.chat_history).toEqual([{ id: 'm1', role: 'user' }]);
  });
});

describe('useApplicationChatConversation — version-id-change reset', () => {
  it('resets to a fresh welcome-message-only history and clears id/uuid once the version id changes and history is non-empty', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' } }),
    });
    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));

    rerender(baseParams({ applicationVersionDetails: { id: 'v-2', welcome_message: 'New version hello' } }));

    await waitFor(() =>
      expect(result.current.activeConversation?.chat_history[0]).toMatchObject({ content: 'New version hello' }),
    );
    expect(result.current.activeConversation?.uuid).toBeUndefined();
    expect(result.current.activeConversation?.id).toBeUndefined();
  });

  it('falls back to a null participant_id on the reset welcome message when activeParticipant is null at the moment of reset', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', welcome_message: 'Hi there' } }),
    });
    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));

    // Directly drive activeParticipant back to null via the exposed setter (a real path any
    // external caller of this hook's return value can take), keeping chat_history non-empty so
    // the reset effect's TRUE branch still fires below.
    act(() => {
      result.current.setActiveParticipant(null);
    });

    rerender(baseParams({ applicationVersionDetails: { id: 'v-2', welcome_message: 'New version hello' } }));

    await waitFor(() =>
      expect(result.current.activeConversation?.chat_history[0]).toMatchObject({ content: 'New version hello' }),
    );
    expect(result.current.activeConversation?.chat_history[0]).not.toHaveProperty('participant_id');
  });

  it('does nothing when chat_history is already empty at the moment the version id changes', async () => {
    const { result, rerender } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1' } }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation?.chat_history).toEqual([]);

    rerender(baseParams({ applicationVersionDetails: { id: 'v-2' } }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.activeConversation?.chat_history).toEqual([]);
  });
});

describe('useApplicationChatConversation — chatHistoryRef sync', () => {
  it('keeps chatHistoryRef.current in sync with activeConversation.chat_history', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.setChatHistory([{ id: 'm1', role: 'user', content: 'hi' }]);
    });

    expect(result.current.chatHistoryRef.current).toEqual([{ id: 'm1', role: 'user', content: 'hi' }]);
  });

  it('setChatHistory is a no-op when there is no active conversation yet', () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ restoredConversationID: 5 }),
    });
    expect(result.current.activeConversation).toBeNull();

    act(() => {
      result.current.setChatHistory([{ id: 'm1', role: 'user' }]);
    });

    expect(result.current.activeConversation).toBeNull();
  });
});

describe('useApplicationChatConversation — attachments passthrough', () => {
  it('exposes attachments/disableAttachments/onAttachFiles wired through useAgentAttachments', async () => {
    const { result } = renderHook((props: UseApplicationChatConversationParams) => useApplicationChatConversation(props), {
      initialProps: baseParams({ applicationVersionDetails: { id: 'v-1', meta: { internal_tools: [] } } }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    expect(result.current.attachments).toEqual([]);
    expect(result.current.disableAttachments).toBe(true);

    // useAgentAttachments' own "clear when disabled" effect only fires when `disableAttachments`
    // ITSELF changes (or on unmount) — it does not re-run (and so does not fight) every time
    // `attachments` changes, so onAttachFiles still works even while disableAttachments is true.
    const file = new File(['x'], 'x.txt');
    act(() => {
      result.current.onAttachFiles([file]);
    });
    expect(result.current.attachments).toEqual([file]);

    act(() => {
      result.current.onClearAttachments();
    });
    expect(result.current.attachments).toEqual([]);
  });
});
